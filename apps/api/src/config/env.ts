import { config } from "dotenv";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Load apps/api/.env first, then fall back to repo-root .env
const here = join(__dirname, "..", "..");
for (const p of [join(here, ".env"), join(here, "..", "..", ".env")]) {
  if (existsSync(p)) config({ path: p });
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",
  port: Number(process.env.API_PORT ?? 4100),
  appUrl: process.env.APP_URL ?? "http://localhost:3100",
  apiUrl: process.env.API_URL ?? "http://localhost:4100",
  // Public origin the browser reaches in production (Railway domain). Used for
  // OAuth redirect URIs so Google calls the public URL, not the internal one.
  publicUrl: process.env.PUBLIC_URL ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-fable-studio",
  // Dev convenience only — defaults OFF, and the production boot guard refuses
  // to start if it is ever true with NODE_ENV=production.
  authDevBypass: bool(process.env.AUTH_DEV_BYPASS, false),
  redisUrl: process.env.REDIS_URL ?? "",
  aiProvider: (process.env.AI_PROVIDER ?? "auto") as "auto" | "openai" | "anthropic" | "gemini" | "mock",
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  geminiKey: process.env.GEMINI_API_KEY ?? "",
  elevenlabsKey: process.env.ELEVENLABS_API_KEY ?? "",
  ytClientId: process.env.YT_CLIENT_ID ?? "",
  ytClientSecret: process.env.YT_CLIENT_SECRET ?? "",
  igAppId: process.env.IG_APP_ID ?? "",
  igAppSecret: process.env.IG_APP_SECRET ?? "",
  tiktokClientKey: process.env.TIKTOK_CLIENT_KEY ?? "",
  tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePrices: {
    starter: process.env.STRIPE_PRICE_STARTER ?? "",
    studio: process.env.STRIPE_PRICE_STUDIO ?? "",
    agency: process.env.STRIPE_PRICE_AGENCY ?? "",
  },
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.R2_BUCKET ?? "fable-studio",
    publicUrl: process.env.R2_PUBLIC_URL ?? "",
  },
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  ytdlpPath: process.env.YTDLP_PATH ?? "yt-dlp",
  /** AI-disclosure at upload: videos flagged containsSyntheticMedia get
   *  `status.containsSyntheticMedia: true` in the YouTube upload metadata.
   *  ON everywhere by default — disclosing AI-generated content is a product
   *  requirement, and a default that is off in production silently fails it.
   *  The field is documented in the YouTube Data API (videos.insert, added
   *  2024-10-30), so the earlier "unverified against the live API" hedge does
   *  not apply. Set YT_SET_SYNTHETIC_DISCLOSURE=false to disable if an upload
   *  ever rejects it. */
  ytSetSyntheticDisclosure: bool(process.env.YT_SET_SYNTHETIC_DISCLOSURE, true),
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL ?? "",
  /** Absolute path to storage root. Override with STORAGE_DIR to point at a
   *  mounted Railway volume for persistence across deploys. */
  storageDir: process.env.STORAGE_DIR
    ? resolve(process.env.STORAGE_DIR)
    : join(here, "..", "..", "storage"),
};
