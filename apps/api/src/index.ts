import { safeJson } from "@fable/shared";
import { createApp } from "./app";
import { env } from "./config/env";
import { readChannelSecret, sealChannelSecret } from "./lib/channelSecrets";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { assertProductionConfig } from "./lib/security";
import { startWorkers } from "./queue/workers";

async function main() {
  // Fail closed on insecure production config (JWT secret, dev bypass, DB).
  assertProductionConfig();
  // One-time cleanup: channels "connected" through the old dev mock path must
  // never masquerade as connected in production — reset them so the UI asks
  // for a real Google OAuth connection instead.
  if (env.isProd) {
    try {
      // Read-then-filter rather than `youtubeJson: { contains: '"mock":true' }`.
      // That substring match worked only while the column was plaintext, and it
      // would not error once sealed — it would simply match nothing, silently
      // leaving mock-connected channels looking connected in production, which
      // is the exact state this sweep exists to prevent.
      const candidates = await prisma.channel.findMany({
        where: { connected: true },
        select: { id: true, youtubeJson: true },
      });
      const mockIds = candidates
        .filter((c) => safeJson<{ mock?: boolean }>(readChannelSecret(c.youtubeJson), {}).mock === true)
        .map((c) => c.id);
      const reset = mockIds.length
        ? await prisma.channel.updateMany({
            where: { id: { in: mockIds } },
            data: { connected: false, youtubeJson: sealChannelSecret("{}") },
          })
        : { count: 0 };
      if (reset.count > 0) logger.info(`Reset ${reset.count} mock-connected channel(s)`);
    } catch (err) {
      logger.warn(
        `Mock-connection cleanup skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const app = createApp();
  app.listen(env.port, () => {
    logger.info(`Fable Studio API listening on http://localhost:${env.port}`);
  });
  await startWorkers();
  logger.info("Background workers started");
}

main().catch((err) => {
  logger.error("Fatal startup error", err instanceof Error ? err.stack : err);
  process.exit(1);
});
