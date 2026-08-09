import { describe, expect, it } from "vitest";
import { isSealed, readChannelSecret, sealChannelSecret } from "./channelSecrets";

const TOKENS = JSON.stringify({
  accessToken: "ya29.a0-access",
  refreshToken: "1//0g-refresh-token-that-never-expires",
  expiryMs: 1_800_000_000_000,
});

describe("channel secret encryption", () => {
  it("round-trips a token blob", () => {
    const sealed = sealChannelSecret(TOKENS);
    expect(readChannelSecret(sealed)).toBe(TOKENS);
  });

  it("does not leave the refresh token readable in the stored value", () => {
    // The whole point: a database dump must not hand over posting rights.
    const sealed = sealChannelSecret(TOKENS);
    expect(sealed).not.toContain("refresh-token-that-never-expires");
    expect(sealed).not.toContain("ya29.");
    expect(isSealed(sealed)).toBe(true);
  });

  it("still reads rows written before encryption existed", () => {
    // Migration is transparent — legacy plaintext stays readable until the
    // channel's next write re-seals it. Without this every connected channel
    // would appear disconnected the moment this shipped.
    expect(readChannelSecret(TOKENS)).toBe(TOKENS);
    expect(isSealed(TOKENS)).toBe(false);
  });

  it("treats empty and missing columns as no tokens", () => {
    expect(readChannelSecret("")).toBe("{}");
    expect(readChannelSecret(null)).toBe("{}");
    expect(readChannelSecret(undefined)).toBe("{}");
  });

  it("fails closed on a tampered or unreadable value", () => {
    // Reads as "no tokens", so the channel looks disconnected and the upload
    // processor refuses to publish — rather than publishing with junk creds.
    const sealed = sealChannelSecret(TOKENS);
    const tampered = `${sealed.slice(0, -4)}AAAA`;
    expect(readChannelSecret(tampered)).toBe("{}");
    expect(readChannelSecret("enc1:not:valid:base64!!")).toBe("{}");
  });

  it("never stores plaintext, even for an empty blob", () => {
    expect(isSealed(sealChannelSecret("{}"))).toBe(true);
    expect(isSealed(sealChannelSecret(""))).toBe(true);
  });
});
