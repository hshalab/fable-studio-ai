"use client";

/** Every clip delivered to a clipping channel, with the same actions as Uploads. */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { VideoStatus, VideoSummary } from "@fable/shared";
import { Scissors, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/widgets/page-header";
import { EmptyState } from "@/components/widgets/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { VideoCard } from "@/components/features/uploads/video-card";
import { SeoEditDialog } from "@/components/features/uploads/seo-edit-dialog";
import { ScheduleDialog } from "@/components/features/uploads/schedule-dialog";
import { AbTestDialog } from "@/components/features/uploads/abtest-dialog";
import { useClipping } from "@/lib/use-clipping";

// Includes "draft", which the Uploads page's filter row deliberately omits.
// Delivered clips arrive as drafts, so leaving it out here would hide the
// entire reason for the page.
type Filter = "all" | Extract<VideoStatus, "draft" | "scheduled" | "published" | "failed">;

const FILTERS: { value: Filter; label: string; dot?: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts", dot: "bg-zinc-400" },
  { value: "scheduled", label: "Scheduled", dot: "bg-sky-400" },
  { value: "published", label: "Published", dot: "bg-emerald-400" },
  { value: "failed", label: "Failed", dot: "bg-red-400" },
];

export default function ClipsPage() {
  const { clips, channelById, isLoading, unreachable, refetch } = useClipping();
  const [filter, setFilter] = useState<Filter>("all");
  const [seoVideo, setSeoVideo] = useState<VideoSummary | null>(null);
  const [scheduleVideo, setScheduleVideo] = useState<VideoSummary | null>(null);
  const [abTestVideo, setAbTestVideo] = useState<VideoSummary | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of clips) c[v.status] = (c[v.status] ?? 0) + 1;
    return c;
  }, [clips]);

  const shown = useMemo(
    () => clips.filter((v) => filter === "all" || v.status === filter),
    [clips, filter],
  );

  return (
    <>
      <PageHeader
        title="Clips"
        description="Delivered from clip-engine. Drafts are inert until you schedule or upload them."
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : unreachable ? (
        <EmptyState
          icon={WifiOff}
          title="Couldn't reach the studio"
          body="Your clips are fine — this page just couldn't load them. Check the API is up, then try again."
          action={<Button onClick={refetch}>Retry</Button>}
        />
      ) : clips.length === 0 ? (
        <EmptyState
          icon={Scissors}
          title="No clips yet"
          body="Deliver from clip-engine with: clip deliver <run> --fable. They land here as drafts on the source's target channel."
          action={
            <Button asChild variant="secondary">
              <Link href="/clipping/channels">Check your channels</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const n = f.value === "all" ? clips.length : counts[f.value] ?? 0;
              return (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    filter === f.value
                      ? "border-indigo-400/40 bg-indigo-400/15 text-foreground"
                      : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.dot && <span className={cn("h-1.5 w-1.5 rounded-full", f.dot)} />}
                  {f.label}
                  <span className="tabular-nums text-muted-foreground/70">{n}</span>
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon={Scissors}
              title={`No ${filter} clips`}
              body="Nothing in this state right now."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((video, index) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  channel={channelById.get(video.channelId)}
                  index={index}
                  onEditSeo={setSeoVideo}
                  onSchedule={setScheduleVideo}
                  onAbTest={setAbTestVideo}
                />
              ))}
            </div>
          )}
        </>
      )}

      <SeoEditDialog
        video={seoVideo}
        open={seoVideo !== null}
        onOpenChange={(open) => !open && setSeoVideo(null)}
      />
      <ScheduleDialog
        video={scheduleVideo}
        open={scheduleVideo !== null}
        onOpenChange={(open) => !open && setScheduleVideo(null)}
      />
      <AbTestDialog
        video={abTestVideo}
        open={abTestVideo !== null}
        onOpenChange={(open) => !open && setAbTestVideo(null)}
      />
    </>
  );
}
