import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import jwt from "jsonwebtoken";
import { safeJson } from "@fable/shared";
import type { Channel, Video } from "@prisma/client";
import { env } from "../../config/env";
import { readChannelSecret, sealChannelSecret } from "../../lib/channelSecrets";
import { createLogger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { getUserKeys } from "../../lib/providerKeys";

const log = createLogger("youtube");

const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

export interface YoutubeTokens {
  accessToken: string;
  refreshToken: string;
  expiryMs: number;
  scope?: string;
  mock?: boolean;
}

export function isYoutubeConfigured(): boolean {
  return Boolean(env.ytClientId && env.ytClientSecret);
}

interface YtClientCreds {
  id: string;
  secret: string;
}

/** OAuth client for a user: their own keys (Settings) with env fallback. */
async function ytCreds(userId: string): Promise<YtClientCreds> {
  const keys = await getUserKeys(userId);
  return { id: keys.ytClientId, secret: keys.ytClientSecret };
}

/** Per-user check — true when the user has OAuth keys (own or server env). */
export async function isYoutubeConfiguredFor(userId: string): Promise<boolean> {
  const creds = await ytCreds(userId);
  return Boolean(creds.id && creds.secret);
}

function redirectUri(): string {
  // In production the browser reaches the public origin (which proxies /api to
  // the internal API); Google must call that public URL. Locally, apiUrl.
  const base = env.publicUrl || env.apiUrl;
  return `${base}/api/v1/oauth/youtube/callback`;
}

function mockTokens(): YoutubeTokens {
  return {
    accessToken: "mock-access-token",
    refreshToken: "mock-refresh-token",
    expiryMs: Date.now() + 3_600_000,
    scope: OAUTH_SCOPES.join(" "),
    mock: true,
  };
}

/** Normalize whatever token shape is stored in channel.youtubeJson. */
function readTokens(channel: Channel): YoutubeTokens {
  const raw = safeJson<Record<string, unknown>>(readChannelSecret(channel.youtubeJson), {});
  const str = (a: unknown, b: unknown): string =>
    typeof a === "string" && a ? a : typeof b === "string" && b ? b : "";
  const num = (a: unknown, b: unknown): number =>
    typeof a === "number" && a > 0 ? a : typeof b === "number" && b > 0 ? b : 0;
  return {
    accessToken: str(raw.accessToken, raw.access_token),
    refreshToken: str(raw.refreshToken, raw.refresh_token),
    expiryMs: num(raw.expiryMs, raw.expiry_date),
    scope: str(raw.scope, undefined) || undefined,
    mock: raw.mock === true,
  };
}

/** True only when the channel holds genuine OAuth tokens AND its owner has keys. */
export async function hasRealYoutubeTokens(channel: Channel): Promise<boolean> {
  if (!channel.connected) return false;
  const tokens = readTokens(channel);
  if (tokens.mock || !tokens.refreshToken || tokens.refreshToken.startsWith("mock-")) return false;
  return isYoutubeConfiguredFor(channel.userId);
}

interface OAuthState {
  channelId: string;
  userId: string;
}

/** Signed, short-lived state binding the consent flow to the owning user —
 *  prevents an attacker binding their tokens onto someone else's channel. */
export function signOAuthState(channelId: string, userId: string): string {
  return jwt.sign({ channelId, userId }, env.jwtSecret, { expiresIn: "15m" });
}

export function verifyOAuthState(state: string): OAuthState | null {
  try {
    const p = jwt.verify(state, env.jwtSecret) as Partial<OAuthState>;
    if (typeof p.channelId === "string" && typeof p.userId === "string") {
      return { channelId: p.channelId, userId: p.userId };
    }
  } catch {
    /* invalid/expired */
  }
  return null;
}

/** Google OAuth consent URL — null when the user has no OAuth keys configured. */
export async function getAuthUrl(channelId: string, userId: string): Promise<string | null> {
  const creds = await ytCreds(userId);
  if (!creds.id || !creds.secret) return null;
  const params = new URLSearchParams({
    client_id: creds.id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signOAuthState(channelId, userId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Exchange an OAuth code for tokens with the user's OAuth client. */
export async function exchangeCode(code: string, userId: string): Promise<YoutubeTokens> {
  const creds = await ytCreds(userId);
  if (!creds.id || !creds.secret) {
    if (!env.isProd) return mockTokens();
    throw new Error("YouTube OAuth keys are not configured");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.id,
      client_secret: creds.secret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(
      `YouTube token exchange failed (${res.status}): ${json.error_description ?? json.error ?? "unknown error"}`,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? "",
    expiryMs: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: json.scope,
  };
}

/** Refresh an access token. No-op passthrough in mock mode / without keys. */
export async function refreshToken(tokens: YoutubeTokens, userId: string): Promise<YoutubeTokens> {
  if (tokens.mock || !tokens.refreshToken) return tokens;
  const creds = await ytCreds(userId);
  if (!creds.id || !creds.secret) return tokens;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: tokens.refreshToken,
      client_id: creds.id,
      client_secret: creds.secret,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(
      `YouTube token refresh failed (${res.status}): ${json.error_description ?? json.error ?? "unknown error"}`,
    );
  }
  return {
    ...tokens,
    accessToken: json.access_token,
    expiryMs: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}

/** Ensure a fresh access token, persisting refreshed tokens on the channel. */
async function freshTokens(channel: Channel): Promise<YoutubeTokens> {
  let tokens = readTokens(channel);
  if (tokens.expiryMs < Date.now() + 60_000) {
    tokens = await refreshToken(tokens, channel.userId);
    const existing = safeJson<Record<string, unknown>>(
      readChannelSecret(channel.youtubeJson), {},
    );
    await prisma.channel.update({
      where: { id: channel.id },
      // Must re-seal. This runs on every token refresh, so writing plaintext
      // here would quietly un-encrypt every active channel within an hour.
      data: {
        youtubeJson: sealChannelSecret(JSON.stringify({ ...existing, ...tokens })),
      },
    });
  }
  return tokens;
}

/**
 * Upload a rendered mp4 via the YouTube resumable upload API. Falls back to a
 * mock youtubeId when the channel has no genuine credentials.
 */
export async function uploadVideo(channel: Channel, video: Video): Promise<{ youtubeId: string }> {
  if (!(await hasRealYoutubeTokens(channel))) {
    return { youtubeId: `mock-${video.id}` };
  }
  const tokens = await freshTokens(channel);

  const filePath = video.filePath
    ? isAbsolute(video.filePath)
      ? video.filePath
      : join(env.storageDir, video.filePath)
    : null;
  if (!filePath || !existsSync(filePath)) {
    throw new Error("Rendered video file is missing on disk — cannot upload");
  }
  const size = statSync(filePath).size;
  const tags = safeJson<string[]>(video.tagsJson, []);

  const metadata = {
    snippet: {
      title: video.title.slice(0, 100),
      description: video.description.slice(0, 4900),
      tags: tags.slice(0, 30),
      categoryId: "24",
    },
    status: {
      privacyStatus: video.visibility,
      selfDeclaredMadeForKids: false,
      // A3 — AI-disclosure: declare synthetic/altered media at upload time for
      // videos flagged by ingest. Behind YT_SET_SYNTHETIC_DISCLOSURE (see
      // config/env.ts) for one release: default ON in dev, OFF in production.
      ...(env.ytSetSyntheticDisclosure && video.containsSyntheticMedia
        ? { containsSyntheticMedia: true }
        : {}),
    },
  };

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!initRes.ok) {
    throw new Error(`YouTube upload init failed (${initRes.status}): ${await initRes.text().catch(() => "")}`);
  }
  const location = initRes.headers.get("location");
  if (!location) throw new Error("YouTube upload init returned no resumable session URL");

  const bytes = await readFile(filePath);
  const uploadRes = await fetch(location, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: new Uint8Array(bytes),
  });
  if (!uploadRes.ok) {
    throw new Error(`YouTube upload failed (${uploadRes.status}): ${await uploadRes.text().catch(() => "")}`);
  }
  const uploaded = (await uploadRes.json().catch(() => ({}))) as { id?: string };
  if (!uploaded.id) throw new Error("YouTube upload succeeded but returned no video id");

  log.info(`Uploaded video ${video.id} to YouTube as ${uploaded.id}`);
  return { youtubeId: uploaded.id };
}

export interface MyChannelInfo {
  title: string;
  handle: string;
  subscriberCount: number;
  thumbnailUrl?: string;
}

/** The connected account's real channel identity (title, @handle, subs). */
export async function fetchMyChannel(channel: Channel): Promise<MyChannelInfo | null> {
  if (!(await hasRealYoutubeTokens(channel))) return null;
  const tokens = await freshTokens(channel);
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
    { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
  );
  if (!res.ok) {
    log.warn(`fetchMyChannel failed (${res.status}): ${await res.text().catch(() => "")}`);
    return null;
  }
  const data = (await res.json().catch(() => ({}))) as {
    items?: {
      snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
      statistics?: { subscriberCount?: string };
    }[];
  };
  const item = data.items?.[0];
  if (!item?.snippet?.title) return null;
  return {
    title: item.snippet.title,
    handle: (item.snippet.customUrl ?? "").replace(/^@+/, ""),
    subscriberCount: Number(item.statistics?.subscriberCount ?? 0) || 0,
    thumbnailUrl: item.snippet.thumbnails?.default?.url,
  };
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Pull REAL per-video statistics (views/likes/comments, near-real-time) from
 * the YouTube Data API for every published video on the channel. Cumulative
 * totals are converted into daily deltas so per-day rows keep summing to the
 * lifetime total everywhere in the app.
 */
export async function syncVideoStats(
  channel: Channel,
): Promise<{ synced: number; mock: boolean }> {
  if (!(await hasRealYoutubeTokens(channel))) return { synced: 0, mock: true };
  const videos = await prisma.video.findMany({
    where: { channelId: channel.id, status: "published", youtubeId: { not: null } },
    select: { id: true, youtubeId: true },
  });
  const real = videos.filter((v) => v.youtubeId && !v.youtubeId.startsWith("mock-"));
  if (real.length === 0) return { synced: 0, mock: false };

  const tokens = await freshTokens(channel);
  const byYoutubeId = new Map(real.map((v) => [v.youtubeId as string, v.id]));
  let synced = 0;

  for (let i = 0; i < real.length; i += 50) {
    const ids = real.slice(i, i + 50).map((v) => v.youtubeId as string);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(",")}`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    );
    if (!res.ok) {
      log.warn(`videos.list statistics failed (${res.status}): ${await res.text().catch(() => "")}`);
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as {
      items?: { id?: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[];
    };
    for (const item of data.items ?? []) {
      const videoId = item.id ? byYoutubeId.get(item.id) : undefined;
      if (!videoId || !item.statistics) continue;
      const totals = {
        views: Number(item.statistics.viewCount ?? 0) || 0,
        likes: Number(item.statistics.likeCount ?? 0) || 0,
        comments: Number(item.statistics.commentCount ?? 0) || 0,
      };
      const date = startOfToday();
      const previous = await prisma.videoStat.aggregate({
        where: { videoId, date: { lt: date } },
        _sum: { views: true, likes: true, comments: true },
      });
      const delta = {
        views: Math.max(0, totals.views - (previous._sum.views ?? 0)),
        likes: Math.max(0, totals.likes - (previous._sum.likes ?? 0)),
        comments: Math.max(0, totals.comments - (previous._sum.comments ?? 0)),
      };
      await prisma.videoStat.upsert({
        where: { videoId_date: { videoId, date } },
        create: { videoId, date, ...delta },
        update: delta,
      });
      synced++;
    }
  }
  log.info(`Synced real stats for ${synced} video(s) on ${channel.name}`);
  return { synced, mock: false };
}

/** Refresh the channel's live identity (subs count etc.) from YouTube. */
export async function refreshChannelIdentity(channel: Channel): Promise<boolean> {
  const info = await fetchMyChannel(channel);
  if (!info) return false;
  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      subscriberCount: info.subscriberCount,
      ...(info.handle ? { handle: info.handle } : {}),
    },
  });
  return true;
}

/** Delete a video from YouTube. No-op success for mock ids / mock mode. */
export async function deleteVideo(channel: Channel, youtubeId: string): Promise<boolean> {
  if (!(await hasRealYoutubeTokens(channel)) || youtubeId.startsWith("mock-")) return true;
  try {
    const tokens = await freshTokens(channel);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(youtubeId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${tokens.accessToken}` } },
    );
    return res.ok || res.status === 404;
  } catch (err) {
    log.warn(`YouTube delete failed for ${youtubeId}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

interface AnalyticsReport {
  rows?: (string | number)[][];
}

/**
 * Pull the last 7 days of channel analytics into AnalyticsSnapshot rows.
 * Mock mode is a deliberate no-op — seeded snapshots come from the seed/mock
 * analytics layer and must not be clobbered.
 */
export async function syncAnalytics(channel: Channel): Promise<{ synced: number; mock: boolean }> {
  if (!(await hasRealYoutubeTokens(channel))) return { synced: 0, mock: true };

  const tokens = await freshTokens(channel);
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const dateKey = (d: Date): string => d.toISOString().slice(0, 10);
  const query = (metrics: string): Promise<Response> => {
    const params = new URLSearchParams({
      ids: "channel==MINE",
      startDate: dateKey(start),
      endDate: dateKey(end),
      metrics,
      dimensions: "day",
    });
    return fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${params.toString()}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
  };
  // estimatedRevenue needs the monetary scope AND a monetized channel —
  // retry without it rather than failing the whole sync.
  let res = await query("views,estimatedMinutesWatched,subscribersGained,estimatedRevenue");
  if (!res.ok) {
    res = await query("views,estimatedMinutesWatched,subscribersGained");
  }
  if (!res.ok) {
    throw new Error(`YouTube Analytics query failed (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const report = (await res.json().catch(() => ({}))) as AnalyticsReport;
  const rows = report.rows ?? [];

  let synced = 0;
  for (const row of rows) {
    const [day, views, minutes, subs, revenueUsd] = row;
    if (typeof day !== "string") continue;
    const date = new Date(`${day}T00:00:00.000Z`);
    const data = {
      views: Math.round(Number(views) || 0),
      watchMinutes: Math.round(Number(minutes) || 0),
      subsGained: Math.round(Number(subs) || 0),
      revenueGbp: Math.round((Number(revenueUsd) || 0) * 0.79 * 100) / 100,
    };
    await prisma.analyticsSnapshot.upsert({
      where: { channelId_date: { channelId: channel.id, date } },
      create: { channelId: channel.id, date, ...data },
      update: data,
    });
    synced++;
  }
  log.info(`Synced ${synced} analytics day(s) for channel ${channel.id}`);
  return { synced, mock: false };
}
