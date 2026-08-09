import { seal, unseal } from "./secretbox";

/**
 * Encryption at rest for a channel's OAuth credentials.
 *
 * These columns hold an access token AND a long-lived refresh token — the
 * refresh token is the valuable one, because it mints new access tokens
 * indefinitely and therefore grants the power to post as the operator until it
 * is revoked. They were stored as bare JSON: anyone with a copy of the database
 * (a backup, a dump, a read-only replica, a leaked connection string) could
 * post to every connected account without touching the app.
 *
 * Provider keys in Settings were already sealed with the same helper, so this
 * closes a gap rather than inventing a scheme.
 *
 * MIGRATION IS TRANSPARENT. Sealed values carry an "enc1:" prefix, so a stored
 * value that lacks it is legacy plaintext and is parsed as-is. Nothing has to
 * be rewritten up front; each channel seals itself the next time its tokens are
 * written. `sealChannelSecret` is unconditional, so no row can regress.
 *
 * FAIL CLOSED. unseal() returns "" on a key mismatch or tamper, which surfaces
 * as "no tokens" — the channel reads as disconnected and the upload processor
 * refuses to publish rather than publishing wrongly. That is the correct
 * direction to fail, but it does mean rotating JWT_SECRET invalidates every
 * stored connection and each channel has to be reconnected.
 */

const SEALED_PREFIX = "enc1:";

/** True when a stored column value is encrypted rather than legacy plaintext. */
export function isSealed(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(SEALED_PREFIX);
}

/** Decrypt a channel secret column, tolerating rows written before encryption. */
export function readChannelSecret(stored: string | null | undefined): string {
  if (!stored) return "{}";
  if (!isSealed(stored)) return stored; // legacy plaintext, still readable
  return unseal(stored) || "{}"; // fail closed: unreadable ⇒ "no tokens"
}

/** Encrypt a channel secret for storage. Always seals — never writes plaintext. */
export function sealChannelSecret(plain: string): string {
  return seal(plain || "{}");
}
