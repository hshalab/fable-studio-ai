import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "../config/env";
import { prisma } from "./prisma";
import { unseal } from "./secretbox";

/**
 * Per-user provider API keys with env fallback.
 *
 * Users paste their own keys in Settings → stored encrypted (ProviderCredential).
 * Effective keys for any piece of work = user's stored keys, falling back to the
 * server-level env vars per field.
 *
 * Two delivery mechanisms:
 *  - AsyncLocalStorage context (`runAsUser` / `activeKeys`) — set once per
 *    authenticated request and per queue job, so deep call sites (AI text, TTS,
 *    music, Whisper) read the right keys without threading params everywhere.
 *  - Explicit lookup (`getUserKeys`) — used by the YouTube service, which always
 *    knows the owning user via channel.userId and must work outside request
 *    context (OAuth callback, stats sync workers).
 */
export interface ProviderKeys {
  openaiKey: string;
  anthropicKey: string;
  geminiKey: string;
  elevenlabsKey: string;
  ytClientId: string;
  ytClientSecret: string;
  igAppId: string;
  igAppSecret: string;
  tiktokClientKey: string;
  tiktokClientSecret: string;
}

function envKeys(): ProviderKeys {
  return {
    openaiKey: env.openaiKey,
    anthropicKey: env.anthropicKey,
    geminiKey: env.geminiKey,
    elevenlabsKey: env.elevenlabsKey,
    ytClientId: env.ytClientId,
    ytClientSecret: env.ytClientSecret,
    igAppId: env.igAppId,
    igAppSecret: env.igAppSecret,
    tiktokClientKey: env.tiktokClientKey,
    tiktokClientSecret: env.tiktokClientSecret,
  };
}

const als = new AsyncLocalStorage<ProviderKeys>();

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { keys: ProviderKeys; at: number }>();

/** Effective keys for a user: their stored (decrypted) keys over env fallback. */
export async function getUserKeys(userId: string): Promise<ProviderKeys> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.keys;

  const base = envKeys();
  let keys = base;
  try {
    const row = await prisma.providerCredential.findUnique({ where: { userId } });
    if (row) {
      // The YouTube OAuth client id + secret are one credential — mixing the
      // user's id with the env secret (or vice versa) guarantees
      // invalid_client at Google. Use the user's PAIR only when both halves
      // are present; otherwise fall back to the env pair atomically.
      const userYtId = unseal(row.ytClientId);
      const userYtSecret = unseal(row.ytClientSecret);
      const ytPair =
        userYtId && userYtSecret
          ? { ytClientId: userYtId, ytClientSecret: userYtSecret }
          : { ytClientId: base.ytClientId, ytClientSecret: base.ytClientSecret };
      // Same atomicity rule for Meta: a user's app id with the server's app
      // secret is not a credential, it is a guaranteed OAuthException.
      const userIgId = unseal(row.igAppId);
      const userIgSecret = unseal(row.igAppSecret);
      const igPair =
        userIgId && userIgSecret
          ? { igAppId: userIgId, igAppSecret: userIgSecret }
          : { igAppId: base.igAppId, igAppSecret: base.igAppSecret };
      const userTtKey = unseal(row.tiktokClientKey);
      const userTtSecret = unseal(row.tiktokClientSecret);
      const tiktokPair =
        userTtKey && userTtSecret
          ? { tiktokClientKey: userTtKey, tiktokClientSecret: userTtSecret }
          : {
              tiktokClientKey: base.tiktokClientKey,
              tiktokClientSecret: base.tiktokClientSecret,
            };
      keys = {
        openaiKey: unseal(row.openaiKey) || base.openaiKey,
        anthropicKey: unseal(row.anthropicKey) || base.anthropicKey,
        geminiKey: unseal(row.geminiKey) || base.geminiKey,
        elevenlabsKey: unseal(row.elevenlabsKey) || base.elevenlabsKey,
        ...ytPair,
        ...igPair,
        ...tiktokPair,
      };
    }
  } catch {
    // Table missing (pre-migration) or transient DB error — env fallback.
  }
  cache.set(userId, { keys, at: Date.now() });
  return keys;
}

/** Call after saving keys so the next use picks up the new values immediately. */
export function invalidateUserKeys(userId: string): void {
  cache.delete(userId);
}

/** Run `fn` with the user's effective keys as the active context. */
export async function runAsUser<T>(
  userId: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!userId) return fn();
  const keys = await getUserKeys(userId);
  return als.run(keys, fn);
}

/** Keys for the current context — user-scoped when inside runAsUser, else env. */
export function activeKeys(): ProviderKeys {
  return als.getStore() ?? envKeys();
}
