"use client";

/**
 * Shared data for the Campaign Clipping section.
 *
 * Clips are identified by CHANNEL, not by a field on the video. The API's
 * VideoSummary carries no clientRef, so "was this ingested from clip-engine"
 * is not answerable from the client — but "does this live on a clipping
 * channel" is, and it is the more useful question anyway: what you post from a
 * clipping channel is clipping work regardless of what produced it.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChannelSummary, VideoSummary } from "@fable/shared";
import { api } from "@/lib/api";

/** Campaign terms from the Ramp brief — the numbers the Payouts view is judged against. */
export const RATE_PER_1K_USD = 3;
export const MIN_VIEWS_TO_SUBMIT = 2000;
export const MAX_PAYOUT_PER_VIDEO_USD = 500;

export function estimatePayoutUsd(views: number): number {
  return Math.min((views / 1000) * RATE_PER_1K_USD, MAX_PAYOUT_PER_VIDEO_USD);
}

export function useClipping() {
  const channels = useQuery({
    queryKey: ["channels"],
    queryFn: () => api.get<ChannelSummary[]>("/channels"),
  });

  const videos = useQuery({
    queryKey: ["videos", "all"],
    queryFn: () => api.get<VideoSummary[]>("/videos"),
  });

  const clipChannels = useMemo(
    () => (channels.data ?? []).filter((c) => c.type !== "wyr"),
    [channels.data],
  );

  const clipChannelIds = useMemo(
    () => new Set(clipChannels.map((c) => c.id)),
    [clipChannels],
  );

  const clips = useMemo(
    () =>
      (videos.data ?? [])
        .filter((v) => clipChannelIds.has(v.channelId))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [videos.data, clipChannelIds],
  );

  const channelById = useMemo(() => {
    const map = new Map<string, ChannelSummary>();
    for (const c of channels.data ?? []) map.set(c.id, c);
    return map;
  }, [channels.data]);

  return {
    clipChannels,
    clips,
    channelById,
    isLoading: channels.isLoading || videos.isLoading,
    // Absent data rather than isError: with the API unreachable react-query
    // settles PAUSED (status pending, fetchStatus idle) rather than errored, so
    // isError never becomes true and an error branch keyed on it is dead code.
    unreachable: !channels.data || !videos.data,
    refetch: () => {
      channels.refetch();
      videos.refetch();
    },
  };
}
