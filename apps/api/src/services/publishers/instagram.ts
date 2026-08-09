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

const log = createLogger("instagram");

/** Graph API version. Pinned: Meta deprecates versions on a schedule. */
const GRAPH = "https://graph.facebook.com/v21.0";
const RUPLOAD = "https://rupload.facebook.com/ig-api-upload/v21.0";

/**
 * Instagram Reels publishing, via "Instagram API with Facebook Login for
 * Business".
 *
 * That path is chosen over plain "Instagram Login" for one concrete reason: it
 * supports a RESUMABLE BINARY UPLOAD, so Fable posts the file's bytes. The
 * other path requires a publicly reachable video_url for Meta to fetch, and
 * Fable cannot guarantee one — R2 storage is optional, and with it unset
 * publicUrl() returns a relative /files/... path that Meta cannot resolve.
 * Choosing this path removes the hosting requirement entirely.
 *
 * Three steps: create a container, upload the bytes to it, publish it.
 */
const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
];

function redirectUri(): string {
  const base = env.publicUrl || env.apiUrl;
  return `${base}/api/v1/oauth/instagram/callback`;
}

async function igCreds(userId: string): Promise<{ id: string; secret: string }> {
  const keys = await getUserKeys(userId);
  return { id: keys.igAppId, secret: keys.igAppSecret };
}

interface GraphError {
  error?: { message?: string; type?: string; code?: number };
}

async function graph<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok || json.error) {
    throw new Error(
      `Instagram API ${res.status}: ${json.error?.message ?? "unknown error"}`,
    );
  }
  return json;
}

/** Resolve a stored relative filePath the same way the YouTube uploader does. */
function resolveMedia(filePath: string): string {
  return isAbsolute(filePath) ? filePath : join(env.storageDir, filePath);
}

export const instagramPublisher: Publisher = {
  id: "instagram",
  label: "Instagram",
  caps: {
    publicAutoPost: true,
    // False precisely because of the resumable-upload path chosen above.
    needsPublicMediaUrl: false,
    maxTitle: 0, // Reels have no title, only a caption
    maxDescription: 2200,
    maxTags: 30, // hashtags live inside the caption
    maxDurationSec: 900,
    dailyPostQuota: 100,
  },

  async isConfiguredFor(userId) {
    const creds = await igCreds(userId);
    return Boolean(creds.id && creds.secret);
  },

  async getAuthUrl(channelId, userId) {
    const creds = await igCreds(userId);
    if (!creds.id || !creds.secret) return null;
    // Same signed, short-lived state as the YouTube flow, plus the platform so
    // one callback route cannot be replayed against another platform.
    const state = jwt.sign({ channelId, userId, platform: "instagram" }, env.jwtSecret, {
      expiresIn: "15m",
    });
    const params = new URLSearchParams({
      client_id: creds.id,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: SCOPES.join(","),
      state,
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`;
  },

  async exchangeCode(code, userId): Promise<StoredTokens> {
    const creds = await igCreds(userId);
    if (!creds.id || !creds.secret) throw new Error("Instagram app credentials are not configured");

    const short = await graph<{ access_token: string }>(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        client_id: creds.id,
        client_secret: creds.secret,
        redirect_uri: redirectUri(),
        code,
      })}`,
    );

    // Short-lived tokens last ~1 hour; exchange immediately for the ~60-day
    // one, or the connection dies before the first scheduled post.
    const long = await graph<{ access_token: string; expires_in?: number }>(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: creds.id,
        client_secret: creds.secret,
        fb_exchange_token: short.access_token,
      })}`,
    );

    const igUserId = await findInstagramAccount(long.access_token);
    return {
      accessToken: long.access_token,
      expiryMs: Date.now() + (long.expires_in ?? 60 * 24 * 3600) * 1000,
      scope: SCOPES.join(","),
      connectedAt: new Date().toISOString(),
      externalAccountId: igUserId ?? "",
    };
  },

  async hasRealTokens(connection) {
    if (!connection) return false;
    const { accessToken, mock, externalAccountId } = connection.tokens;
    if (mock || !accessToken) return false;
    return Boolean(externalAccountId || connection.externalAccountId);
  },

  async fetchIdentity(connection): Promise<AccountIdentity | null> {
    const token = connection.tokens.accessToken;
    const igId = connection.externalAccountId || connection.tokens.externalAccountId;
    if (!token || !igId) return null;
    try {
      const me = await graph<{
        id: string;
        username?: string;
        name?: string;
        followers_count?: number;
      }>(`${GRAPH}/${igId}?fields=id,username,name,followers_count&access_token=${token}`);
      return {
        externalAccountId: me.id,
        displayName: me.name ?? me.username ?? "",
        handle: me.username ? `@${me.username}` : "",
        followerCount: me.followers_count ?? 0,
      };
    } catch (err) {
      log.warn(`identity fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  },

  async publish(connection, video: Video): Promise<PublishResult> {
    const token = connection.tokens.accessToken;
    const igId = connection.externalAccountId || connection.tokens.externalAccountId;
    if (!token || !igId) throw new Error("Instagram connection is missing a token or account id");
    if (!video.filePath) throw new Error("Video has no rendered file to upload");

    const bytes = await readFile(resolveMedia(video.filePath));
    const caption = video.description.slice(0, instagramPublisher.caps.maxDescription);

    // 1. Container, asking for the resumable upload protocol.
    const container = await graph<{ id: string }>(`${GRAPH}/${igId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        upload_type: "resumable",
        caption,
        access_token: token,
      }),
    });

    // 2. The bytes. Single request — the same shape as the YouTube uploader,
    //    which also reads the whole file rather than streaming it.
    const uploadRes = await fetch(`${RUPLOAD}/${container.id}`, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${token}`,
        offset: "0",
        file_size: String(bytes.byteLength),
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(bytes),
    });
    if (!uploadRes.ok) {
      throw new Error(
        `Instagram upload failed (${uploadRes.status}): ${(await uploadRes.text()).slice(0, 300)}`,
      );
    }

    // 3. Publish. Meta transcodes asynchronously, so a container can be
    //    accepted and then rejected; the caller records the failure on the post.
    const published = await graph<{ id: string }>(`${GRAPH}/${igId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: container.id, access_token: token }),
    });

    return {
      externalId: published.id,
      externalUrl: `https://www.instagram.com/reel/${published.id}/`,
      state: "published",
    };
  },
};

/**
 * The IG professional account behind the user's Pages.
 *
 * A Meta token authenticates a PERSON, not an Instagram account: the IG id has
 * to be discovered through the Pages they administer. No linked professional
 * account means publishing is impossible, and saying so here is far clearer
 * than an opaque permission error at the first scheduled post.
 */
async function findInstagramAccount(token: string): Promise<string | null> {
  const pages = await graph<{
    data?: { id: string; instagram_business_account?: { id: string } }[];
  }>(`${GRAPH}/me/accounts?fields=instagram_business_account&access_token=${token}`);
  for (const page of pages.data ?? []) {
    if (page.instagram_business_account?.id) return page.instagram_business_account.id;
  }
  return null;
}

/** Re-seal a refreshed long-lived token. Meta refreshes by re-exchanging. */
export async function refreshInstagramToken(
  connection: ResolvedConnection,
  userId: string,
): Promise<StoredTokens> {
  const creds = await igCreds(userId);
  const token = connection.tokens.accessToken;
  if (!creds.id || !creds.secret || !token) return connection.tokens;
  const long = await graph<{ access_token: string; expires_in?: number }>(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: creds.id,
      client_secret: creds.secret,
      fb_exchange_token: token,
    })}`,
  );
  const next: StoredTokens = {
    ...connection.tokens,
    accessToken: long.access_token,
    expiryMs: Date.now() + (long.expires_in ?? 60 * 24 * 3600) * 1000,
  };
  await updateTokens(connection.channelId, "instagram", next);
  return next;
}
