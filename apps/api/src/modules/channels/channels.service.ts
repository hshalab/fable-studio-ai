import type {
  Branding,
  ChannelSummary,
  ChannelType,
  UploadDefaults,
  WeeklySchedule,
} from "@fable/shared";
import { DEFAULT_WEEKLY_SCHEDULE, VOICE_PRESETS, safeJson } from "@fable/shared";
import { env } from "../../config/env";
import { readChannelSecret, sealChannelSecret } from "../../lib/channelSecrets";
import { AppError, badRequest, notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { exchangeCode, fetchMyChannel, getAuthUrl, isYoutubeConfiguredFor } from "../../services/youtube";
import { toUpcomingSlot } from "../schedule/schedule.service";
import { toVideoSummary } from "../videos/videos.service";

// ── Per-type defaults used when seeding a new channel ────────────────────────

interface TypeDefaults {
  avatarColor: string;
  secondaryColor: string;
  musicStyle: string;
  introText: string;
  outroText: string;
  cta: string;
}

const TYPE_DEFAULTS: Record<ChannelType, TypeDefaults> = {
  wyr: {
    avatarColor: "#8b5cf6",
    secondaryColor: "#22d3ee",
    musicStyle: "upbeat-quiz",
    introText: "Would you rather…",
    outroText: "Which side are you on?",
    cta: "Comment your pick 👇",
  },
  clips: {
    avatarColor: "#a855f7",
    secondaryColor: "#f97316",
    musicStyle: "trap-energy",
    introText: "Wait for it…",
    outroText: "Full clip on the channel!",
    cta: "Follow for daily clips 🔥",
  },
  top5: {
    avatarColor: "#d946ef",
    secondaryColor: "#facc15",
    musicStyle: "comedy-suspense",
    introText: "Number 5 will surprise you…",
    outroText: "Did number 1 deserve it?",
    cta: "Follow so you never miss a countdown 😂",
  },
};

const DEFAULT_UPLOAD_DEFAULTS: UploadDefaults = {
  visibility: "public",
  category: "24", // Entertainment
  madeForKids: false,
  notifySubscribers: true,
  language: "en",
};

function buildDefaultBranding(type: ChannelType, handle: string): Branding {
  const d = TYPE_DEFAULTS[type];
  const preset = VOICE_PRESETS[0];
  return {
    primaryColor: d.avatarColor,
    secondaryColor: d.secondaryColor,
    font: "Inter",
    watermarkText: handle,
    introText: d.introText,
    outroText: d.outroText,
    cta: d.cta,
    voice: {
      provider: preset.provider,
      voiceId: preset.id,
      gender: preset.gender,
      accent: preset.accent,
      energy: "high",
      emotion: "excited",
    },
    musicStyle: d.musicStyle,
  };
}

/** Handles are stored BARE (no @) — display layers add a single @ prefix. */
function normalizeHandle(handle: string): string {
  return handle.trim().replace(/\s+/g, "").replace(/^@+/, "");
}

// ── Stored youtubeJson shape (flat — matches services/youtube readTokens; ────
// tokens are NEVER returned to the client)

interface StoredYoutube {
  mock?: boolean;
  connectedAt?: string;
  accessToken?: string;
  refreshToken?: string;
  expiryMs?: number;
  scope?: string;
}

// ── Mappers ──────────────────────────────────────────────────────────────────

interface ChannelSummaryRow {
  id: string;
  name: string;
  handle: string;
  type: string;
  avatarColor: string;
  connected: boolean;
  subscriberCount: number;
  snapshots: { views: number }[];
  _count: { videos: number };
}

/** Canonical ChannelSummary — viewsToday from latest snapshot, videosReady from filtered count. */
export function toChannelSummary(channel: ChannelSummaryRow): ChannelSummary {
  return {
    id: channel.id,
    name: channel.name,
    handle: channel.handle,
    type: channel.type as ChannelType,
    avatarColor: channel.avatarColor,
    connected: channel.connected,
    subscriberCount: channel.subscriberCount,
    viewsToday: channel.snapshots[0]?.views ?? 0,
    videosReady: channel._count.videos,
  };
}

const summaryInclude = {
  snapshots: { orderBy: { date: "desc" as const }, take: 1, select: { views: true } },
  _count: { select: { videos: { where: { status: "ready" } } } },
};

async function getOwnedChannel(userId: string, channelId: string) {
  const channel = await prisma.channel.findFirst({ where: { id: channelId, userId } });
  if (!channel) throw notFound("Channel");
  return channel;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listChannels(userId: string): Promise<ChannelSummary[]> {
  const channels = await prisma.channel.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: summaryInclude,
  });
  return channels.map(toChannelSummary);
}

export async function getChannelDetail(userId: string, channelId: string) {
  const now = new Date();
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, userId },
    include: {
      ...summaryInclude,
      automation: true,
      videos: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { stats: { select: { views: true } } },
      },
      slots: {
        where: { scheduledAt: { gte: now }, status: { in: ["scheduled", "queued"] } },
        orderBy: { scheduledAt: "asc" },
        take: 5,
        include: { video: { include: { stats: { select: { views: true } } } } },
      },
    },
  });
  if (!channel) throw notFound("Channel");

  const yt = safeJson<StoredYoutube>(readChannelSecret(channel.youtubeJson), {});
  const type = channel.type as ChannelType;

  return {
    ...toChannelSummary(channel),
    description: channel.description,
    createdAt: channel.createdAt.toISOString(),
    branding: safeJson<Branding>(channel.brandingJson, buildDefaultBranding(type, channel.handle)),
    uploadDefaults: safeJson<UploadDefaults>(channel.uploadDefaultsJson, DEFAULT_UPLOAD_DEFAULTS),
    schedule: safeJson<WeeklySchedule>(channel.scheduleJson, DEFAULT_WEEKLY_SCHEDULE),
    prompts: safeJson<Record<string, string>>(channel.promptsJson, {}),
    youtube: {
      mock: Boolean(yt.mock),
      hasTokens: Boolean(yt.accessToken),
    },
    recentVideos: channel.videos.map((v) => toVideoSummary(v, channel.name)),
    nextSlots: channel.slots.map((slot) =>
      toUpcomingSlot({ ...slot, channel: { name: channel.name } }),
    ),
    automation: channel.automation
      ? {
          enabled: channel.automation.enabled,
          config: safeJson<Record<string, unknown>>(channel.automation.configJson, {}),
          lastRunAt: channel.automation.lastRunAt
            ? channel.automation.lastRunAt.toISOString()
            : null,
        }
      : null,
  };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function createChannel(
  userId: string,
  input: { name: string; handle: string; type: ChannelType; description?: string },
) {
  const handle = normalizeHandle(input.handle);
  if (handle.length < 2) throw badRequest("Handle cannot be empty");
  const defaults = TYPE_DEFAULTS[input.type];
  const channel = await prisma.channel.create({
    data: {
      userId,
      name: input.name,
      handle,
      type: input.type,
      description: input.description ?? "",
      avatarColor: defaults.avatarColor,
      brandingJson: JSON.stringify(buildDefaultBranding(input.type, handle)),
      uploadDefaultsJson: JSON.stringify(DEFAULT_UPLOAD_DEFAULTS),
      scheduleJson: JSON.stringify(DEFAULT_WEEKLY_SCHEDULE),
      promptsJson: JSON.stringify({}),
      youtubeJson: sealChannelSecret(JSON.stringify({})),
    },
  });
  return getChannelDetail(userId, channel.id);
}

export interface ChannelPatch {
  name?: string;
  handle?: string;
  description?: string;
  avatarColor?: string;
  branding?: Partial<Branding>;
  uploadDefaults?: Partial<UploadDefaults>;
  schedule?: WeeklySchedule;
  prompts?: Record<string, string>;
}

export async function updateChannel(userId: string, channelId: string, patch: ChannelPatch) {
  const channel = await getOwnedChannel(userId, channelId);
  const type = channel.type as ChannelType;

  // Partial objects merge over the stored JSON; schedule/prompts replace wholesale
  // (the weekly grid + prompt editors always submit the complete object).
  const mergedBranding = patch.branding
    ? {
        ...safeJson<Branding>(channel.brandingJson, buildDefaultBranding(type, channel.handle)),
        ...patch.branding,
      }
    : undefined;
  const mergedUploadDefaults = patch.uploadDefaults
    ? {
        ...safeJson<UploadDefaults>(channel.uploadDefaultsJson, DEFAULT_UPLOAD_DEFAULTS),
        ...patch.uploadDefaults,
      }
    : undefined;

  await prisma.channel.update({
    where: { id: channel.id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.handle !== undefined ? { handle: normalizeHandle(patch.handle) } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.avatarColor !== undefined ? { avatarColor: patch.avatarColor } : {}),
      ...(mergedBranding ? { brandingJson: JSON.stringify(mergedBranding) } : {}),
      ...(mergedUploadDefaults
        ? { uploadDefaultsJson: JSON.stringify(mergedUploadDefaults) }
        : {}),
      ...(patch.schedule !== undefined ? { scheduleJson: JSON.stringify(patch.schedule) } : {}),
      ...(patch.prompts !== undefined ? { promptsJson: JSON.stringify(patch.prompts) } : {}),
    },
  });
  return getChannelDetail(userId, channel.id);
}

export async function deleteChannel(userId: string, channelId: string) {
  const channel = await getOwnedChannel(userId, channelId);
  await prisma.channel.delete({ where: { id: channel.id } });
  return { deleted: true };
}

// ── YouTube connect / disconnect ─────────────────────────────────────────────

async function markMockConnected(channelId: string): Promise<void> {
  await prisma.channel.update({
    where: { id: channelId },
    data: {
      connected: true,
      youtubeJson: sealChannelSecret(
        JSON.stringify({
          mock: true,
          connectedAt: new Date().toISOString(),
        } satisfies StoredYoutube),
      ),
    },
  });
}

/**
 * Real mode (user has YT OAuth keys — own or server env): returns the Google
 * consent URL — the browser completes the flow and Google redirects back to
 * the oauth callback route.
 *
 * Without keys: NEVER fake a connection in production — the user is pointed
 * at Settings → API keys instead. Dev keeps the instant mock connect so the
 * product stays explorable with zero setup.
 */
export async function connectChannel(userId: string, channelId: string) {
  const channel = await getOwnedChannel(userId, channelId);

  const authUrl = await getAuthUrl(channel.id, userId);
  if (authUrl) {
    return { authUrl, connected: channel.connected };
  }

  if (env.isProd) {
    throw new AppError(
      "YouTube isn't configured yet — add your YouTube Client ID and Client Secret in Settings → API keys, then try connecting again.",
      400,
      "YT_KEYS_MISSING",
    );
  }

  await markMockConnected(channel.id);
  return { authUrl: null, connected: true };
}

export async function disconnectChannel(userId: string, channelId: string) {
  const channel = await getOwnedChannel(userId, channelId);
  await prisma.channel.update({
    where: { id: channel.id },
    data: { connected: false, youtubeJson: sealChannelSecret(JSON.stringify({})) },
  });
  return { connected: false };
}

/**
 * Completes the OAuth callback for a channel (state = channelId). With real YT
 * keys the code is exchanged at Google's token endpoint; without keys (or an
 * empty code) the channel is mock-connected so the flow always succeeds in dev.
 * Tokens are stored flat in youtubeJson — the exact shape services/youtube reads.
 */
export async function completeOAuthCallback(
  channelId: string,
  code: string,
  stateUserId: string,
): Promise<void> {
  // Ownership binding: the signed state carried the userId who started the
  // flow — the channel MUST belong to them. Blocks binding tokens to another
  // user's channel.
  const channel = await prisma.channel.findFirst({ where: { id: channelId, userId: stateUserId } });
  if (!channel) throw notFound("Channel");

  const configured = await isYoutubeConfiguredFor(stateUserId);
  if (!configured || !code) {
    if (!env.isProd) {
      await markMockConnected(channel.id);
      return;
    }
    throw badRequest("YouTube OAuth could not complete — API keys are missing");
  }

  const tokens = await exchangeCode(code, stateUserId);
  // Google only returns refresh_token on first consent — keep the stored one otherwise.
  const previous = safeJson<StoredYoutube>(readChannelSecret(channel.youtubeJson), {});
  const stored: StoredYoutube = {
    connectedAt: new Date().toISOString(),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || previous.refreshToken,
    expiryMs: tokens.expiryMs,
    scope: tokens.scope,
  };
  await prisma.channel.update({
    where: { id: channel.id },
    data: { connected: true, youtubeJson: sealChannelSecret(JSON.stringify(stored)) },
  });

  // Best-effort: adopt the real channel identity (title, @handle, subs) so the
  // dashboard reflects the actual YouTube channel, not the demo placeholder.
  try {
    const fresh = await prisma.channel.findUnique({ where: { id: channel.id } });
    const info = fresh ? await fetchMyChannel(fresh) : null;
    if (info) {
      await prisma.channel.update({
        where: { id: channel.id },
        data: {
          name: info.title,
          ...(info.handle ? { handle: info.handle } : {}),
          subscriberCount: info.subscriberCount,
        },
      });
    }
  } catch {
    // Identity sync is cosmetic — never fail the OAuth flow over it.
  }
}
