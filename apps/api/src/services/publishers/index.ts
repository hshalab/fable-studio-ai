import type { PlatformId } from "../../lib/connections";
import { instagramPublisher } from "./instagram";
import { tiktokPublisher } from "./tiktok";
import type { Publisher } from "./types";
import { youtubePublisher } from "./youtube";

export * from "./types";

/**
 * The publisher registry.
 *
 * Callers resolve a destination here and branch on `publisher.caps`, never on
 * the platform id. That is the whole point of the indirection: TikTok's audit
 * state is one boolean in one place rather than a string comparison repeated
 * through the scheduler, the upload processor and the UI.
 */
const REGISTRY: Partial<Record<PlatformId, Publisher>> = {
  youtube: youtubePublisher,
  instagram: instagramPublisher,
  tiktok: tiktokPublisher,
};

export function getPublisher(platform: PlatformId): Publisher {
  const publisher = REGISTRY[platform];
  if (!publisher) {
    throw new Error(`No publisher registered for platform "${platform}"`);
  }
  return publisher;
}

export function availablePlatforms(): PlatformId[] {
  return Object.keys(REGISTRY) as PlatformId[];
}

export function isSupported(platform: string): platform is PlatformId {
  return platform in REGISTRY;
}
