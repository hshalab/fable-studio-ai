"use client";

/** The channels clipping work posts from. */

import Link from "next/link";
import { Scissors, WifiOff } from "lucide-react";
import { PageHeader } from "@/components/widgets/page-header";
import { EmptyState } from "@/components/widgets/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChannelCard } from "@/components/features/channels/channel-card";
import { useClipping } from "@/lib/use-clipping";

export default function ClipChannelsPage() {
  const { clipChannels, isLoading, unreachable, refetch } = useClipping();

  return (
    <>
      <PageHeader
        title="Channels"
        description="Anything that is not a Would-You-Rather channel posts clipping work. Connecting and branding still live in the main studio."
        actions={
          <Button asChild variant="secondary">
            <Link href="/channels">Manage in studio</Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : unreachable ? (
        <EmptyState
          icon={WifiOff}
          title="Couldn't reach the studio"
          body="Your channels are fine — this page just couldn't load them. Check the API is up, then try again."
          action={<Button onClick={refetch}>Retry</Button>}
        />
      ) : clipChannels.length === 0 ? (
        <EmptyState
          icon={Scissors}
          title="No clipping channels yet"
          body="Add a channel in the main studio and set its type to AI Clips. clip-engine delivers to whichever channel a source is registered against."
          action={
            <Button asChild>
              <Link href="/channels">Go to Channels</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clipChannels.map((channel, index) => (
            <ChannelCard key={channel.id} channel={channel} index={index} />
          ))}
        </div>
      )}
    </>
  );
}
