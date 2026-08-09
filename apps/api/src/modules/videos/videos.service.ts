import type { VideoStatus, VideoSummary } from "@fable/shared";
import { QUEUE_JOBS, clamp, fnv1a, pick, safeJson, seededRandom } from "@fable/shared";
import { readChannelSecret } from "../../lib/channelSecrets";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { activeKeys } from "../../lib/providerKeys";
import { deleteVideo as deleteYoutubeVideo } from "../../services/youtube";
import { enqueue } from "../../queue/queue";

// ── Structural row types (subset of the Prisma models we map from) ───────────

interface VideoRow {
  id: string;
  channelId: string;
  projectId: string | null;
  clipId: string | null;
  title: string;
  description: string;
  tagsJson: string;
  hashtagsJson: string;
  filePath: string | null;
  thumbnailPath: string | null;
  durationSec: number;
  status: string;
  visibility: string;
  viralScore: number;
  youtubeId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  /** Set by the prune tick when an expired draft's media was deleted. */
  mediaExpired?: boolean;
}

interface StatRow {
  date: Date;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  ctr: number;
  avgPct: number;
  curveJson: string;
}

interface AbTestRow {
  id: string;
  kind: string;
  variantsJson: string;
  status: string;
  winnerIdx: number | null;
  createdAt: Date;
}

/** Flat token shape stored in channel.youtubeJson (matches services/youtube). */
interface StoredYoutube {
  mock?: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiryMs?: number;
}

// ── Mappers ──────────────────────────────────────────────────────────────────

/** Canonical VideoSummary mapper — also used by channels + schedule modules. */
export function toVideoSummary(
  video: VideoRow & { channel?: { name: string } | null; stats?: { views: number }[] },
  channelName?: string,
): VideoSummary {
  return {
    id: video.id,
    channelId: video.channelId,
    channelName: channelName ?? video.channel?.name,
    title: video.title,
    status: video.status as VideoStatus,
    viralScore: video.viralScore,
    durationSec: video.durationSec,
    thumbnailPath: video.thumbnailPath,
    youtubeId: video.youtubeId,
    publishedAt: video.publishedAt ? video.publishedAt.toISOString() : null,
    views: video.stats ? video.stats.reduce((sum, s) => sum + s.views, 0) : undefined,
    createdAt: video.createdAt.toISOString(),
    // Surfaced so an expired draft is visibly dead in the dashboard instead of
    // looking approvable right up until the upload fails.
    mediaExpired: video.mediaExpired ?? false,
  };
}

function toAbTest(test: AbTestRow) {
  return {
    id: test.id,
    kind: test.kind,
    variants: safeJson<string[]>(test.variantsJson, []),
    status: test.status,
    winnerIdx: test.winnerIdx,
    createdAt: test.createdAt.toISOString(),
  };
}

function channelTrulyConnected(channel: { connected: boolean; youtubeJson: string }): boolean {
  const yt = safeJson<StoredYoutube>(readChannelSecret(channel.youtubeJson), {});
  // Key presence comes from the active per-user key context (request-scoped),
  // falling back to server env keys.
  const keys = activeKeys();
  return (
    channel.connected &&
    Boolean(keys.ytClientId && keys.ytClientSecret) &&
    !yt.mock &&
    Boolean(yt.refreshToken) &&
    !(yt.refreshToken ?? "").startsWith("mock-")
  );
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listVideos(
  userId: string,
  filters: { channelId?: string; status?: string },
): Promise<VideoSummary[]> {
  const videos = await prisma.video.findMany({
    where: {
      channel: { userId },
      ...(filters.channelId ? { channelId: filters.channelId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    include: {
      channel: { select: { name: true } },
      stats: { select: { views: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return videos.map((v) => toVideoSummary(v));
}

async function getOwnedVideoWithChannel(userId: string, videoId: string) {
  const video = await prisma.video.findFirst({
    where: { id: videoId, channel: { userId } },
    include: {
      channel: { select: { id: true, name: true, connected: true, youtubeJson: true } },
      slot: true,
    },
  });
  if (!video) throw notFound("Video");
  return video;
}

/**
 * Mock A/B decider: a running test older than 60s gets a winner picked with
 * seeded randomness (stable per test id) — gives a "live experiment" feel.
 */
async function decideDueAbTests(tests: AbTestRow[]): Promise<AbTestRow[]> {
  const now = Date.now();
  const decided: AbTestRow[] = [];
  for (const test of tests) {
    if (test.status === "running" && now - test.createdAt.getTime() > 60_000) {
      const variants = safeJson<string[]>(test.variantsJson, []);
      const winnerIdx =
        variants.length > 0 ? Math.floor(seededRandom(fnv1a(test.id))() * variants.length) : 0;
      const updated = await prisma.abTest.update({
        where: { id: test.id },
        data: { status: "decided", winnerIdx },
      });
      decided.push(updated);
    } else {
      decided.push(test);
    }
  }
  return decided;
}

export async function getVideoDetail(userId: string, videoId: string) {
  const video = await prisma.video.findFirst({
    where: { id: videoId, channel: { userId } },
    include: {
      channel: { select: { id: true, name: true, connected: true, youtubeJson: true } },
      project: { select: { id: true, title: true, type: true, status: true } },
      stats: { orderBy: { date: "asc" } },
      abTests: { orderBy: { createdAt: "desc" } },
      slot: { select: { id: true, scheduledAt: true, status: true } },
    },
  });
  if (!video) throw notFound("Video");

  const abTests = await decideDueAbTests(video.abTests);
  const stats: StatRow[] = video.stats;
  const latestStat = stats.length > 0 ? stats[stats.length - 1] : null;

  return {
    ...toVideoSummary({ ...video, stats: video.stats }),
    description: video.description,
    visibility: video.visibility,
    filePath: video.filePath,
    tags: safeJson<string[]>(video.tagsJson, []),
    hashtags: safeJson<string[]>(video.hashtagsJson, []),
    stats: stats.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      views: s.views,
      likes: s.likes,
      comments: s.comments,
      shares: s.shares,
      ctr: s.ctr,
      avgPct: s.avgPct,
    })),
    retention: latestStat
      ? safeJson<{ pct: number; value: number }[]>(latestStat.curveJson, [])
      : [],
    abTests: abTests.map(toAbTest),
    project: video.project
      ? {
          id: video.project.id,
          title: video.project.title,
          type: video.project.type,
          status: video.project.status,
        }
      : null,
    slot: video.slot
      ? {
          id: video.slot.id,
          scheduledAt: video.slot.scheduledAt.toISOString(),
          status: video.slot.status,
        }
      : null,
  };
}

// ── Mutations ────────────────────────────────────────────────────────────────

export interface VideoPatch {
  title?: string;
  description?: string;
  tags?: string[];
  hashtags?: string[];
  visibility?: "public" | "unlisted" | "private";
  status?: VideoStatus;
}

export async function updateVideo(userId: string, videoId: string, patch: VideoPatch) {
  await getOwnedVideoWithChannel(userId, videoId);
  const updated = await prisma.video.update({
    where: { id: videoId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.tags !== undefined ? { tagsJson: JSON.stringify(patch.tags) } : {}),
      ...(patch.hashtags !== undefined ? { hashtagsJson: JSON.stringify(patch.hashtags) } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    },
    include: { channel: { select: { name: true } }, stats: { select: { views: true } } },
  });
  return {
    ...toVideoSummary(updated),
    description: updated.description,
    visibility: updated.visibility,
    tags: safeJson<string[]>(updated.tagsJson, []),
    hashtags: safeJson<string[]>(updated.hashtagsJson, []),
  };
}

export async function uploadVideoNow(userId: string, videoId: string) {
  const video = await getOwnedVideoWithChannel(userId, videoId);
  if (video.status === "uploading") throw conflict("Video is already uploading");
  if (video.status === "published") throw conflict("Video is already published");
  if (video.status === "rendering") throw conflict("Video is still rendering");

  // Real uploads need an actual rendered file; mock uploads work without one.
  if (channelTrulyConnected(video.channel) && !video.filePath) {
    throw badRequest("Video has no rendered file to upload yet");
  }

  await prisma.video.update({ where: { id: video.id }, data: { status: "uploading" } });
  if (video.slot && (video.slot.status === "scheduled" || video.slot.status === "queued")) {
    await prisma.scheduleSlot.update({
      where: { id: video.slot.id },
      data: { status: "queued" },
    });
  }
  const jobId = await enqueue(QUEUE_JOBS.VIDEO_UPLOAD, { videoId: video.id });
  return {
    jobId,
    video: toVideoSummary({ ...video, status: "uploading" }, video.channel.name),
  };
}

export async function deleteVideo(userId: string, videoId: string) {
  const video = await getOwnedVideoWithChannel(userId, videoId);
  if (video.status === "published" && video.youtubeId && channelTrulyConnected(video.channel)) {
    // Best-effort real deletion via the youtube service — it refreshes the
    // access token with the owner's OAuth creds first (stored tokens are
    // usually expired) and no-ops cleanly for mock ids/channels.
    const channel = await prisma.channel.findUnique({ where: { id: video.channel.id } });
    if (channel) {
      await deleteYoutubeVideo(channel, video.youtubeId).catch(() => undefined);
    }
  }
  await prisma.video.delete({ where: { id: video.id } });
  return { deleted: true };
}

export async function createAbTest(
  userId: string,
  videoId: string,
  kind: "thumbnail" | "title",
  variants: string[],
) {
  await getOwnedVideoWithChannel(userId, videoId);
  const test = await prisma.abTest.create({
    data: { videoId, kind, variantsJson: JSON.stringify(variants), status: "running" },
  });
  return toAbTest(test);
}

// ── Repost with deterministic "AI-improved" packaging ────────────────────────

const TITLE_PREFIXES = [
  "WAIT FOR IT:",
  "99% FAIL:",
  "NOBODY EXPECTED:",
  "IMPOSSIBLE:",
  "THIS BROKE THE INTERNET:",
] as const;

const TITLE_SUFFIXES = [
  "(Part 2)",
  "(GONE WRONG)",
  "— 99% Get It Wrong",
  "(Try Not To Fail)",
  "— You Won't Last 30 Seconds",
] as const;

const TITLE_EMOJIS = ["🤯", "😱", "🔥", "💀", "👀"] as const;

const DESCRIPTION_HOOKS = [
  "Back by popular demand — this one broke the comments last time. Can you beat it?",
  "You asked for it again. Same challenge, higher stakes. Don't blink.",
  "This clip refused to die. Round two starts NOW.",
  "Most people failed this the first time. Your rematch is here.",
  "The sequel nobody was ready for. Watch to the end.",
] as const;

function improveTitle(title: string, rand: () => number): string {
  // Strip our own suffixes/prefixes so a repost-of-a-repost doesn't stack.
  let base = title.trim();
  for (const p of TITLE_PREFIXES) {
    if (base.toUpperCase().startsWith(p)) base = base.slice(p.length).trim();
  }
  for (const s of TITLE_SUFFIXES) {
    if (base.endsWith(s)) base = base.slice(0, base.length - s.length).trim();
  }
  const mode = Math.floor(rand() * 3);
  let improved: string;
  if (mode === 0) improved = `${pick(rand, TITLE_PREFIXES)} ${base}`;
  else if (mode === 1) improved = `${base} ${pick(rand, TITLE_SUFFIXES)}`;
  else improved = `${pick(rand, TITLE_PREFIXES)} ${base} ${pick(rand, TITLE_EMOJIS)}`;
  return improved.length > 95 ? `${improved.slice(0, 92).trimEnd()}…` : improved;
}

function improveDescription(description: string, title: string, rand: () => number): string {
  const hook = pick(rand, DESCRIPTION_HOOKS);
  const body = description.trim() || title;
  return `${hook}\n\n${body}`;
}

export async function repostVideo(userId: string, videoId: string) {
  const video = await getOwnedVideoWithChannel(userId, videoId);
  const rand = seededRandom(fnv1a(`${video.id}:${video.title}`));
  const title = improveTitle(video.title, rand);
  const description = improveDescription(video.description, title, rand);
  const viralScore = clamp(video.viralScore + 2 + Math.floor(rand() * 8), 0, 99);

  const repost = await prisma.video.create({
    data: {
      channelId: video.channelId,
      projectId: video.projectId,
      clipId: video.clipId,
      title,
      description,
      tagsJson: video.tagsJson,
      hashtagsJson: video.hashtagsJson,
      filePath: video.filePath,
      thumbnailPath: video.thumbnailPath,
      durationSec: video.durationSec,
      status: "draft",
      visibility: video.visibility,
      viralScore,
      // Provenance travels with the media. A repost publishes the SAME file,
      // so dropping these would strip the AI disclosure and the rights credit
      // from the copy — the original stays compliant while its repost quietly
      // does not. clientRef is deliberately NOT copied: it is the ingest
      // idempotency key and is unique per delivered clip.
      containsSyntheticMedia: video.containsSyntheticMedia,
      attribution: video.attribution,
    },
    include: { channel: { select: { name: true } } },
  });

  return {
    ...toVideoSummary(repost),
    description: repost.description,
    visibility: repost.visibility,
    tags: safeJson<string[]>(repost.tagsJson, []),
    hashtags: safeJson<string[]>(repost.hashtagsJson, []),
    repostedFromId: video.id,
  };
}
