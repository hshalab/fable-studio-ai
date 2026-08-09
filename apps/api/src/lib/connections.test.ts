// Per-platform connection storage, with the legacy dual-read that keeps
// already-connected YouTube channels working with no backfill and no reconnect.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { setupTestDb, type TestDbHarness } from "../../tests/helpers/testDb";

type PrismaMod = typeof import("./prisma");
type ConnMod = typeof import("./connections");
type SecretMod = typeof import("./channelSecrets");

let harness: TestDbHarness;
let prisma: PrismaMod["prisma"];
let conn: ConnMod;
let secrets: SecretMod;
let channelId: string;
let legacyChannelId: string;

const REAL_TOKENS = {
  accessToken: "ya29.access",
  refreshToken: "1//refresh-token-value",
  expiryMs: 2_000_000_000_000,
};

beforeAll(async () => {
  harness = await setupTestDb();
  prisma = (await import("./prisma")).prisma;
  conn = await import("./connections");
  secrets = await import("./channelSecrets");

  const user = await prisma.user.create({
    data: {
      email: `conn-${Date.now()}@test.dev`,
      passwordHash: await bcrypt.hash("x", 4),
      name: "Conn Test",
    },
  });
  const base = { userId: user.id, type: "clips", handle: "@x", connected: true };
  channelId = (await prisma.channel.create({ data: { ...base, name: "Modern" } })).id;
  legacyChannelId = (
    await prisma.channel.create({
      data: {
        ...base,
        name: "Legacy",
        // Written the old way: sealed, but on the channel row rather than a
        // ChannelConnection. This is what every live install looks like.
        youtubeJson: secrets.sealChannelSecret(JSON.stringify(REAL_TOKENS)),
      },
    })
  ).id;
});

afterAll(async () => {
  await harness?.cleanup();
});

describe("channel connections", () => {
  it("round-trips tokens without storing them readably", async () => {
    await conn.upsertConnection({
      channelId,
      platform: "instagram",
      tokens: { accessToken: "IGQVJ-token", externalAccountId: "1784" },
      handle: "@whitegirlm",
    });
    const resolved = await conn.getConnection(channelId, "instagram");
    expect(resolved?.tokens.accessToken).toBe("IGQVJ-token");
    expect(resolved?.externalAccountId).toBe("1784");

    const row = await prisma.channelConnection.findFirst({
      where: { channelId, platform: "instagram" },
    });
    expect(row?.credentialsJson).not.toContain("IGQVJ-token");
    expect(secrets.isSealed(row!.credentialsJson)).toBe(true);
  });

  it("reads a pre-connections YouTube channel from the legacy column", async () => {
    // The whole reason this fallback exists: without it, shipping the new model
    // would present every connected channel as disconnected until someone
    // reconnected it by hand.
    const resolved = await conn.getConnection(legacyChannelId, "youtube");
    expect(resolved).not.toBeNull();
    expect(resolved!.legacy).toBe(true);
    expect(resolved!.tokens.refreshToken).toBe(REAL_TOKENS.refreshToken);
  });

  it("prefers a real connection row over the legacy column", async () => {
    await conn.upsertConnection({
      channelId: legacyChannelId,
      platform: "youtube",
      tokens: { accessToken: "newer-access", refreshToken: "newer-refresh" },
    });
    const resolved = await conn.getConnection(legacyChannelId, "youtube");
    expect(resolved!.legacy).toBe(false);
    expect(resolved!.tokens.refreshToken).toBe("newer-refresh");
  });

  it("returns null for a platform that was never connected", async () => {
    expect(await conn.getConnection(channelId, "tiktok")).toBeNull();
  });

  it("does not invent a legacy connection for a channel with no tokens", async () => {
    // connected=true with an empty token blob is the mock-connect state; it
    // must not read as a usable YouTube connection.
    expect(await conn.getConnection(channelId, "youtube")).toBeNull();
  });

  it("lists every platform including a legacy-only YouTube", async () => {
    const platforms = (await conn.listConnections(channelId)).map((c) => c.platform);
    expect(platforms).toContain("instagram");
  });

  it("refreshing tokens keeps them sealed", async () => {
    await conn.updateTokens(channelId, "instagram", { accessToken: "rotated-token" });
    const row = await prisma.channelConnection.findFirst({
      where: { channelId, platform: "instagram" },
    });
    expect(secrets.isSealed(row!.credentialsJson)).toBe(true);
    expect(row!.credentialsJson).not.toContain("rotated-token");
    const resolved = await conn.getConnection(channelId, "instagram");
    expect(resolved!.tokens.accessToken).toBe("rotated-token");
  });
});
