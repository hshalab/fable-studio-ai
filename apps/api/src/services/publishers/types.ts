import type { Video } from "@prisma/client";
import type { PlatformId, ResolvedConnection, StoredTokens } from "../../lib/connections";

export type { PlatformId, ResolvedConnection, StoredTokens };

export interface PublishResult {
  externalId: string;
  externalUrl?: string;
  /**
   * published        — live and publicly visible
   * awaiting_creator — uploaded to the app's drafts; the human taps post
   * private          — live but not publicly visible (TikTok pre-audit)
   */
  state: "published" | "awaiting_creator" | "private";
}

export interface AccountIdentity {
  externalAccountId: string;
  displayName: string;
  handle: string;
  followerCount: number;
}

/**
 * What a destination can do. Callers branch on CAPABILITIES, never on the
 * platform id — `if (platform === "tiktok")` scattered through the scheduler is
 * how the TikTok audit result ends up hardcoded in six places.
 */
export interface PublisherCaps {
  /** False until TikTok's audit passes: unaudited apps are forced to SELF_ONLY. */
  publicAutoPost: boolean;
  /** True if the platform fetches the file from a URL instead of taking bytes. */
  needsPublicMediaUrl: boolean;
  maxTitle: number;
  maxDescription: number;
  maxTags: number;
  maxDurationSec: number;
  /** Posts per rolling 24h per account, or null when the platform sets none. */
  dailyPostQuota: number | null;
}

export interface Publisher {
  id: PlatformId;
  label: string;
  caps: PublisherCaps;

  /** True when the OWNER has usable client credentials for this platform. */
  isConfiguredFor(userId: string): Promise<boolean>;
  /** Consent URL, or null when the owner has no client credentials yet. */
  getAuthUrl(channelId: string, userId: string): Promise<string | null>;
  exchangeCode(code: string, userId: string): Promise<StoredTokens>;
  /** Genuine (non-mock, non-expired-beyond-refresh) credentials. */
  hasRealTokens(connection: ResolvedConnection | null, userId: string): Promise<boolean>;
  fetchIdentity(connection: ResolvedConnection, userId: string): Promise<AccountIdentity | null>;
  publish(connection: ResolvedConnection, video: Video, userId: string): Promise<PublishResult>;
}
