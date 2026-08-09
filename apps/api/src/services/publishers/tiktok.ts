import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import jwt from "jsonwebtoken";
import type { Video } from "@prisma/client";
import { env } from "../../config/env";
import { updateTokens } from "../../lib/connections";
import { createLogger } from "../../lib/logger";
import { getUserKeys } from "../../lib/providerKeys";
import type {
  AccountIdentity,
  Publisher,
  PublishResult,
  ResolvedConnection,
  StoredTokens,
} from "./types";

const log = createLogger("tiktok");

const API = "https://open.tiktokapis.com/v2";
const AUTHORIZE = "https://www.tiktok.com/v2/auth/authorize/";

/**
 * TikTok — upload to the creator's INBOX, not Direct Post.
 *
 * Direct Post (`video.publish`) requires passing TikTok's audit. Until then an
 * unaudited client's posts are forced to private viewing, so a "scheduled
 * public post" would silently produce something nobody can see and that earns
 * nothing on a per-view campaign. Rather than ship that, this uploads to the
 * creator's drafts and reports `awaiting_creator`, so the scheduler and the UI
 * never claim a video is live when it is not.
 *
 * Swapping to Direct Post after an audit is a change of endpoint and scope, not
 * of shape — hence `caps.publicAutoPost`, which everything else branches on.
 */
const SCOPES = ["user.info.basic", "video.upload"];

/** TikTok caps pending uploads per creator; exceeding it fails the whole batch. */
const MAX_PENDING_PER_DAY = 5;

/** Single-chunk upload. TikTok requires chunks be at least 5MB unless it is the only one. */
const SINGLE_CHUNK = 1;

function redirectUri(): string {
  const base = env.publicUrl || env.apiUrl;
  return `${base}/api/v1/oauth/tiktok/callback`;
}

async function tiktokCreds(userId: string): Promise<{ key: string; secret: string }> {
  const keys = await getUserKeys(userId);
  return { key: keys.tiktokClientKey, secret: keys.tiktokClientSecret };
}

interface TikTokEnvelope {
  error?: { code?: string; message?: string; log_id?: string };
}

async function callApi<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T } & TikTokEnvelope;
  // TikTok returns 200 with an error object rather than an HTTP error, so the
  // status alone is not a success signal.
  if (!res.ok || (json.error?.code && json.error.code !== "ok")) {
    throw new Error(
      `TikTok ${path} failed (${res.status}): ${json.error?.message ?? "unknown error"}`,
    );
  }
  return (json.data ?? ({} as T)) as T;
}

function resolveMedia(filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(env.storageDir, filePath);
}

export const tiktokPublisher: Publisher = {
  id: "tiktok",
  label: "TikTok",
  caps: {
    // FALSE until the app passes TikTok's audit. Everything downstream reads
    // this rather than comparing the platform name.
    publicAutoPost: false,
    needsPublicMediaUrl: false,
    maxTitle: 0, // the caption is the whole text
    maxDescription: 2200,
    maxTags: 0,
    maxDurationSec: 600,
    dailyPostQuota: MAX_PENDING_PER_DAY,
  },

  async isConfiguredFor(userId) {
    const creds = await tiktokCreds(userId);
    return Boolean(creds.key && creds.secret);
  },

  async getAuthUrl(channelId, userId) {
    const creds = await tiktokCreds(userId);
    if (!creds.key || !creds.secret) return null;
    const state = jwt.sign({ channelId, userId, platform: "tiktok" }, env.jwtSecret, {
      expiresIn: "15m",
    });
    const params = new URLSearchParams({
      client_key: creds.key, // client_KEY, not client_id — TikTok differs from OAuth convention
      scope: SCOPES.join(","),
      response_type: "code",
      redirect_uri: redirectUri(),
      state,
    });
    return `${AUTHORIZE}?${params.toString()}`;
  },

  async exchangeCode(code, userId): Promise<StoredTokens> {
    const creds = await tiktokCreds(userId);
    if (!creds.key || !creds.secret) throw new Error("TikTok app credentials are not configured");
    const res = await fetch(`${API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: creds.key,
        client_secret: creds.secret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      open_id?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new Error(
        `TikTok token exchange failed (${res.status}): ${json.error_description ?? json.error ?? "unknown"}`,
      );
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? "",
      // Access tokens last 24h — short enough that refresh is the normal path,
      // not an edge case.
      expiryMs: Date.now() + (json.expires_in ?? 86_400) * 1000,
      scope: json.scope ?? SCOPES.join(","),
      connectedAt: new Date().toISOString(),
      externalAccountId: json.open_id ?? "",
    };
  },

  async hasRealTokens(connection) {
    if (!connection) return false;
    const { accessToken, refreshToken, mock } = connection.tokens;
    return Boolean(!mock && accessToken && refreshToken);
  },

  async fetchIdentity(connection, userId): Promise<AccountIdentity | null> {
    const tokens = await freshTikTokTokens(connection, userId);
    if (!tokens.accessToken) return null;
    try {
      const res = await fetch(
        `${API}/user/info/?fields=open_id,display_name,follower_count`,
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
      );
      const json = (await res.json().catch(() => ({}))) as {
        data?: { user?: { open_id?: string; display_name?: string; follower_count?: number } };
      };
      const user = json.data?.user;
      if (!user) return null;
      return {
        externalAccountId: user.open_id ?? "",
        displayName: user.display_name ?? "",
        handle: user.display_name ? `@${user.display_name}` : "",
        followerCount: user.follower_count ?? 0,
      };
    } catch (err) {
      log.warn(`identity fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  },

  async publish(connection, video: Video, userId): Promise<PublishResult> {
    if (!video.filePath) throw new Error("Video has no rendered file to upload");
    const tokens = await freshTikTokTokens(connection, userId);
    if (!tokens.accessToken) throw new Error("TikTok connection has no usable access token");

    const bytes = await readFile(resolveMedia(video.filePath));
    const size = bytes.byteLength;

    // Init the inbox upload. NOT /v2/post/publish/video/init/ — that is Direct
    // Post and needs video.publish plus a passed audit.
    const init = await callApi<{ publish_id: string; upload_url: string }>(
      "/post/publish/inbox/video/init/",
      tokens.accessToken,
      {
        source_info: {
          source: "FILE_UPLOAD",
          video_size: size,
          chunk_size: size,
          total_chunk_count: SINGLE_CHUNK,
        },
      },
    );

    const put = await fetch(init.upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(size),
        // Inclusive byte range, then total — TikTok rejects an off-by-one here
        // with an opaque error.
        "Content-Range": `bytes 0-${size - 1}/${size}`,
      },
      body: new Uint8Array(bytes),
    });
    if (!put.ok) {
      throw new Error(
        `TikTok upload failed (${put.status}): ${(await put.text()).slice(0, 300)}`,
      );
    }

    return {
      externalId: init.publish_id,
      // No public URL exists: it is a draft inside the app until the creator
      // opens TikTok and posts it.
      state: "awaiting_creator",
    };
  },
};

/**
 * A valid access token, refreshing when it is close to expiry.
 *
 * TikTok access tokens last 24 hours, so unlike YouTube this runs constantly
 * rather than occasionally, and a failure here means the connection is dead
 * rather than momentarily stale.
 */
export async function freshTikTokTokens(
  connection: ResolvedConnection,
  userId: string,
): Promise<StoredTokens> {
  const tokens = connection.tokens;
  if ((tokens.expiryMs ?? 0) > Date.now() + 120_000) return tokens;
  if (!tokens.refreshToken) return tokens;

  const creds = await tiktokCreds(userId);
  if (!creds.key || !creds.secret) return tokens;

  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: creds.key,
      client_secret: creds.secret,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!res.ok || !json.access_token) return tokens;

  const next: StoredTokens = {
    ...tokens,
    accessToken: json.access_token,
    // TikTok rotates the refresh token; keeping the old one strands the
    // connection at the next refresh.
    refreshToken: json.refresh_token ?? tokens.refreshToken,
    expiryMs: Date.now() + (json.expires_in ?? 86_400) * 1000,
  };
  await updateTokens(connection.channelId, "tiktok", next);
  return next;
}
