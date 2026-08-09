"use client";

/**
 * Which clips are eligible to claim, and roughly what they are worth.
 *
 * The brief pays per 1k views, but only once a clip passes a view floor, and
 * caps each one — so "how am I doing" is not a view count, it is a count of
 * clips over the line. That is the question this page answers.
 *
 * Everything here is an ESTIMATE and says so. The real figure is decided by
 * whoever reviews the submission, and the view number comes from whenever
 * stats last synced, not from this instant.
 */

import Link from "next/link";
import type { VideoSummary } from "@fable/shared";
import { BadgePoundSterling, WifiOff } from "lucide-react";
import { PageHeader } from "@/components/widgets/page-header";
import { EmptyState } from "@/components/widgets/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MAX_PAYOUT_PER_VIDEO_USD,
  MIN_VIEWS_TO_SUBMIT,
  RATE_PER_1K_USD,
  estimatePayoutUsd,
  useClipping,
} from "@/lib/use-clipping";

function Row({ video, channelName }: { video: VideoSummary; channelName?: string }) {
  const views = video.views ?? 0;
  const eligible = views >= MIN_VIEWS_TO_SUBMIT;
  const usd = estimatePayoutUsd(views);
  const capped = usd >= MAX_PAYOUT_PER_VIDEO_USD;
  const progress = Math.min(100, (views / MIN_VIEWS_TO_SUBMIT) * 100);

  return (
    <li className="glass flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:gap-5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{video.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {channelName ?? "Unknown channel"}
        </p>
        {!eligible && (
          <div className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-indigo-400/70"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-5 sm:gap-8">
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{views.toLocaleString()}</div>
          <div className="text-[11px] text-muted-foreground">views</div>
        </div>
        <div className="text-right">
          <div
            className={cn(
              "text-sm font-semibold tabular-nums",
              eligible ? "text-emerald-300" : "text-muted-foreground",
            )}
          >
            ${usd.toFixed(2)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {capped ? "at cap" : "estimate"}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium",
            eligible
              ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-300"
              : "border-white/10 bg-white/5 text-muted-foreground",
          )}
        >
          {eligible
            ? "Claimable"
            : `${(MIN_VIEWS_TO_SUBMIT - views).toLocaleString()} to go`}
        </span>
      </div>
    </li>
  );
}

export default function PayoutsPage() {
  const { clips, channelById, isLoading, unreachable, refetch } = useClipping();

  const published = clips.filter((c) => c.status === "published");
  const ranked = [...published].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  const claimable = ranked.filter((c) => (c.views ?? 0) >= MIN_VIEWS_TO_SUBMIT);
  const total = claimable.reduce((sum, c) => sum + estimatePayoutUsd(c.views ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Payouts"
        description={`$${RATE_PER_1K_USD} per 1k views · $${MAX_PAYOUT_PER_VIDEO_USD} cap per clip · ${MIN_VIEWS_TO_SUBMIT.toLocaleString()} views before you can submit.`}
      />

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : unreachable ? (
        <EmptyState
          icon={WifiOff}
          title="Couldn't reach the studio"
          body="Your clips are fine — this page just couldn't load them. Check the API is up, then try again."
          action={<Button onClick={refetch}>Retry</Button>}
        />
      ) : published.length === 0 ? (
        <EmptyState
          icon={BadgePoundSterling}
          title="Nothing published yet"
          body="A clip has to be live and past the view floor before it can be submitted. Publish some clips first."
          action={
            <Button asChild variant="secondary">
              <Link href="/clipping/clips">Go to Clips</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="glass mb-6 flex flex-wrap items-end justify-between gap-4 rounded-2xl p-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Estimated claimable
              </div>
              <div className="font-display text-4xl font-bold tabular-nums text-emerald-300">
                ${total.toFixed(2)}
              </div>
            </div>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground/80">
              {claimable.length} of {published.length} published clips are past the floor.
              Submission needs a screen recording of each clip&apos;s own analytics — account-level
              stats get rejected.
            </p>
          </div>

          <ul className="space-y-3">
            {ranked.map((video) => (
              <Row
                key={video.id}
                video={video}
                channelName={channelById.get(video.channelId)?.name}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
