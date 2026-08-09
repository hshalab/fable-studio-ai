"use client";

/** Campaign Clipping overview — the state of the clipping side in one screen. */

import Link from "next/link";
import { motion } from "framer-motion";
import { Film, Scissors, Send, Tv, WifiOff } from "lucide-react";
import { PageHeader } from "@/components/widgets/page-header";
import { EmptyState } from "@/components/widgets/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ENTER, staggerDelay } from "@/lib/motion";
import {
  MIN_VIEWS_TO_SUBMIT,
  estimatePayoutUsd,
  useClipping,
} from "@/lib/use-clipping";

export default function ClippingOverviewPage() {
  const { clipChannels, clips, isLoading, unreachable, refetch } = useClipping();

  const drafts = clips.filter((c) => c.status === "draft");
  const published = clips.filter((c) => c.status === "published");
  const claimable = published.filter((c) => (c.views ?? 0) >= MIN_VIEWS_TO_SUBMIT);
  const claimableUsd = claimable.reduce((sum, c) => sum + estimatePayoutUsd(c.views ?? 0), 0);

  const stats = [
    { label: "Clips", value: clips.length, hint: `${drafts.length} awaiting review`, icon: Film, href: "/clipping/clips" },
    { label: "Published", value: published.length, hint: `${claimable.length} past ${MIN_VIEWS_TO_SUBMIT.toLocaleString()} views`, icon: Send, href: "/clipping/clips" },
    { label: "Claimable", value: `$${claimableUsd.toFixed(0)}`, hint: "estimated, before review", icon: Scissors, href: "/clipping/payouts" },
    { label: "Channels", value: clipChannels.length, hint: "posting clipping work", icon: Tv, href: "/clipping/channels" },
  ];

  return (
    <>
      <PageHeader
        title="Campaign Clipping"
        description="Clips cut to paid briefs. clip-engine renders them on your machine and delivers them here as drafts."
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : unreachable ? (
        <EmptyState
          icon={WifiOff}
          title="Couldn't reach the studio"
          body="Your clips are fine — this page just couldn't load them. Check the API is up, then try again."
          action={<Button onClick={refetch}>Retry</Button>}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...ENTER, delay: staggerDelay(index) }}
              >
                <Link
                  href={stat.href}
                  className="glass glass-hover flex h-full flex-col gap-1 rounded-2xl p-5"
                >
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <stat.icon className="h-3.5 w-3.5" />
                    {stat.label}
                  </div>
                  <div className="font-display text-3xl font-bold tabular-nums">{stat.value}</div>
                  <div className="text-xs text-muted-foreground/70">{stat.hint}</div>
                </Link>
              </motion.div>
            ))}
          </div>

          {clips.length === 0 && (
            <div className="mt-6">
              <EmptyState
                icon={Scissors}
                title="No clips delivered yet"
                body="Register the brief's footage in clip-engine, render the moments you want, then deliver to Fable. They arrive here as drafts."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/clipping/channels">Check your channels</Link>
                  </Button>
                }
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
