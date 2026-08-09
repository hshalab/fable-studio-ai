import { safeJson } from "@fable/shared";
import type { ChannelConnection } from "@prisma/client";
import { readChannelSecret, sealChannelSecret } from "./channelSecrets";
import { prisma } from "./prisma";

/**
 * Reading and writing a channel's per-platform credentials.
 *
 * Every path goes through sealChannelSecret/readChannelSecret, so no caller can
 * accidentally persist a refresh token in the clear.
 *
 * LEGACY DUAL-READ. YouTube credentials lived on Channel.youtubeJson before
 * connections existed, and live installs still hold them there. getConnection
 * therefore falls back to that column for platform "youtube" and presents it as
 * a synthetic connection, so every connected channel keeps working with no
 * backfill and no reconnect. Writes always go to ChannelConnection; the old
 * column is left untouched rather than deleted, so a rollback does not strand
 * anyone.
 */

export type PlatformId = "youtube" | "instagram" | "tiktok";

export const PLATFORMS: PlatformId[] = ["youtube", "instagram", "tiktok"];

export interface StoredTokens {
  accessToken?: string;
  refreshToken?: string;
  expiryMs?: number;
  scope?: string;
  mock?: boolean;
  connectedAt?: string;
  /** Instagram: the IG user id the token acts as. TikTok: open_id. */
  externalAccountId?: string;
}

/** A connection plus its decrypted tokens. Never hand the raw row to callers. */
export interface ResolvedConnection {
  id: string | null; // null for a legacy youtubeJson-backed connection
  channelId: string;
  platform: PlatformId;
  tokens: StoredTokens;
  externalAccountId: string;
  displayName: string;
  handle: string;
  status: string;
  /** True when this came from Channel.youtubeJson rather than a real row. */
  legacy: boolean;
}

function decode(row: ChannelConnection): ResolvedConnection {
  return {
    id: row.id,
    channelId: row.channelId,
    platform: row.platform as PlatformId,
    tokens: safeJson<StoredTokens>(readChannelSecret(row.credentialsJson), {}),
    externalAccountId: row.externalAccountId,
    displayName: row.displayName,
    handle: row.handle,
    status: row.status,
    legacy: false,
  };
}

export async function getConnection(
  channelId: string,
  platform: PlatformId,
): Promise<ResolvedConnection | null> {
  const row = await prisma.channelConnection.findUnique({
    where: { channelId_platform: { channelId, platform } },
  });
  if (row) return decode(row);

  if (platform !== "youtube") return null;
  // Legacy: credentials still on the channel row.
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, youtubeJson: true, connected: true, name: true, handle: true },
  });
  if (!channel) return null;
  const tokens = safeJson<StoredTokens>(readChannelSecret(channel.youtubeJson), {});
  if (!tokens.accessToken && !tokens.refreshToken && !tokens.mock) return null;
  return {
    id: null,
    channelId: channel.id,
    platform: "youtube",
    tokens,
    externalAccountId: "",
    displayName: channel.name,
    handle: channel.handle,
    status: channel.connected ? "connected" : "revoked",
    legacy: true,
  };
}

export async function listConnections(channelId: string): Promise<ResolvedConnection[]> {
  const rows = await prisma.channelConnection.findMany({ where: { channelId } });
  const resolved = rows.map(decode);
  if (!resolved.some((c) => c.platform === "youtube")) {
    const legacy = await getConnection(channelId, "youtube");
    if (legacy) resolved.push(legacy);
  }
  return resolved;
}

export interface UpsertConnectionInput {
  channelId: string;
  platform: PlatformId;
  tokens: StoredTokens;
  externalAccountId?: string;
  displayName?: string;
  handle?: string;
  scopes?: string;
}

export async function upsertConnection(input: UpsertConnectionInput): Promise<void> {
  const credentialsJson = sealChannelSecret(JSON.stringify(input.tokens));
  const shared = {
    credentialsJson,
    externalAccountId: input.externalAccountId ?? input.tokens.externalAccountId ?? "",
    displayName: input.displayName ?? "",
    handle: input.handle ?? "",
    scopes: input.scopes ?? input.tokens.scope ?? "",
    status: "connected",
    lastError: null,
  };
  await prisma.channelConnection.upsert({
    where: { channelId_platform: { channelId: input.channelId, platform: input.platform } },
    create: { channelId: input.channelId, platform: input.platform, ...shared },
    update: shared,
  });
}

/** Persist refreshed tokens without disturbing identity fields. */
export async function updateTokens(
  channelId: string,
  platform: PlatformId,
  tokens: StoredTokens,
): Promise<void> {
  const credentialsJson = sealChannelSecret(JSON.stringify(tokens));
  const existing = await prisma.channelConnection.findUnique({
    where: { channelId_platform: { channelId, platform } },
    select: { id: true },
  });
  if (existing) {
    await prisma.channelConnection.update({
      where: { id: existing.id },
      data: { credentialsJson },
    });
    return;
  }
  // Legacy YouTube channel refreshing for the first time: write through to the
  // old column so behaviour is unchanged until it is properly connected.
  if (platform === "youtube") {
    await prisma.channel.update({
      where: { id: channelId },
      data: { youtubeJson: credentialsJson },
    });
  }
}

export async function markConnectionError(
  channelId: string,
  platform: PlatformId,
  message: string,
): Promise<void> {
  await prisma.channelConnection.updateMany({
    where: { channelId, platform },
    data: { status: "needs_reauth", lastError: message.slice(0, 500) },
  });
}

export async function disconnect(channelId: string, platform: PlatformId): Promise<void> {
  await prisma.channelConnection.deleteMany({ where: { channelId, platform } });
  if (platform === "youtube") {
    await prisma.channel.update({
      where: { id: channelId },
      data: { connected: false, youtubeJson: sealChannelSecret("{}") },
    });
  }
}
