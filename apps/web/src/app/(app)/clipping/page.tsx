"use client";

/**
 * Campaign Clipping — the home of the paid-brief side of the account.
 *
 * A UI grouping over the channel types that already exist, NOT a new type:
 * ChannelType is "wyr" | "clips" | "top5" and both API zod enums reject
 * anything else, so a fourth value would be refused at the boundary.
 *
 * It reuses the ["channels"] query the channels page already populates, so
 * arriving here from anywhere in the app renders from cache rather than
 * refetching.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Scissors, WifiOff } from "lucide-react";
import type { ChannelSummary } from "@fable/shared";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/widgets/page-header";
import { EmptyState } from "@/components/widgets/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChannelCard } from "@/components/features/channels/channel-card";

export default function ClippingPage() {
  const { data: channels, isLoading, refetch } = useQuery({
    queryKey: ["channels"],
    queryFn: () => api.get<ChannelSummary[]>("/channels"),
  });

  // Everything that is not a Would-You-Rather channel belongs to this side of
  // the account. Filtering by "not wyr" rather than listing clip types means a
  // channel type added later shows up here instead of vanishing from both
  // sections.
  const clipChannels = (channels ?? []).filter((channel) => channel.type !== "wyr");

  return (
    <>
      <PageHeader
        title="Campaign Clipping"
        description="Channels you post paid clipping work from. Briefs supply the caption and the approved on-screen text — clip-engine renders to them."
        actions={
          <Button asChild variant="secondary">
            <Link href="/channels">Manage channels</Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : !channels ? (
        // Distinguished from "none yet" deliberately. An unreachable API and
        // an empty account look identical to the query, but telling someone
        // their channels are gone when the server is simply down sends them
        // hunting for a problem that is not there.
        //
        // Keyed on "no data" rather than isError because those are not the
        // same set: with the API down, react-query settles PAUSED rather than
        // errored (status pending, fetchStatus idle), so isError stays false
        // and an isError branch never renders — verified by instrumenting the
        // component against a stopped API. Absent data covers both.
        <EmptyState
          icon={WifiOff}
          title="Couldn't reach the studio"
          body="Your channels are fine — this page just couldn't load them. Check the API is up, then try again."
          action={<Button onClick={() => refetch()}>Retry</Button>}
        />
      ) : clipChannels.length === 0 ? (
        <EmptyState
          icon={Scissors}
          title="No clipping channels yet"
          body="Campaign clips post from a normal channel. Add one on the Channels page and set its type to AI Clips, then register the brief's footage in clip-engine."
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
