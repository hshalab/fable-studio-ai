"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Activity, Coins, ListTodo, Play, Square, UploadCloud, Zap } from "lucide-react";
import { formatCompact, formatGbp } from "@fable/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/widgets/page-header";
import { StudioFloor } from "@/components/features/studio/studio-floor";
import { useFloorReplay } from "@/components/features/studio/use-floor-replay";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

type AgentKey = "writer" | "voice" | "render" | "upload" | "analyst";

interface StudioState {
  agents: { key: AgentKey; status: "idle" | "working" | "queued"; task: string | null; progress: number | null }[];
  logs: { atMs: number; agent: AgentKey | "system"; job: string; line: string }[];
  usage: { tokens: number; estCostGbp: number; sinceLabel: string };
  counters: {
    generatedToday: number;
    rendersToday: number;
    uploadsToday: number;
    uploadQuota: number;
    queueDepth: number;
  };
}

const AGENT_META: Record<
  AgentKey,
  { name: string; role: string; emoji: string; color: string; gradient: string }
> = {
  writer: {
    name: "Quill",
    role: "Scriptwriter · GPT",
    emoji: "✍️",
    color: "text-violet-300",
    gradient: "from-violet-500 to-fuchsia-500",
  },
  voice: {
    name: "George",
    role: "Voiceover · ElevenLabs",
    emoji: "🎙️",
    color: "text-pink-300",
    gradient: "from-pink-500 to-rose-500",
  },
  render: {
    name: "Bay-1",
    role: "Render bay · FFmpeg",
    emoji: "🎬",
    color: "text-blue-300",
    gradient: "from-blue-500 to-indigo-500",
  },
  upload: {
    name: "Dock",
    role: "Upload dock · YouTube",
    emoji: "📤",
    color: "text-emerald-300",
    gradient: "from-emerald-500 to-teal-500",
  },
  analyst: {
    name: "Ledger",
    role: "Stats analyst · Data API",
    emoji: "📊",
    color: "text-amber-300",
    gradient: "from-amber-500 to-orange-500",
  },
};

const LOG_COLORS: Record<string, string> = {
  writer: "text-violet-400",
  voice: "text-pink-400",
  render: "text-blue-400",
  upload: "text-emerald-400",
  analyst: "text-amber-400",
  system: "text-zinc-400",
};

export default function StudioPage() {
  const state = useQuery({
    queryKey: ["studio-state"],
    queryFn: () => api.get<StudioState>("/studio/state"),
    refetchInterval: 2500,
  });
  const terminalRef = useRef<HTMLDivElement>(null);
  const [replaying, setReplaying] = useState(false);
  const replay = useFloorReplay(state.data?.logs, replaying);

  const d = state.data;
  // During replay the floor and terminal read from the replay cursor; the
  // counters keep their real values but count up in step with it, so the
  // numbers on screen are always ones the pipeline actually produced.
  const agents = replay.active ? replay.agents : d?.agents ?? [];
  const logs = replay.active ? replay.logs : d?.logs ?? [];
  const scale = replay.active ? replay.progress : 1;

  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Studio Floor"
        description="Your AI crew at work — live pipeline, real logs, real spend."
      />

      {!d ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {/* ── The studio floor: isometric tycoon sim ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
          >
            <StudioFloor
              agents={agents}
              queueDepth={replay.active ? Math.max(0, replay.total - replay.logs.length) : d.counters.queueDepth}
            />
          </motion.div>

          {/* Replay: the last real run, slowed to something you can record. */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setReplaying((v) => !v)}
              disabled={!replaying && (d.logs?.length ?? 0) === 0}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors",
                replaying
                  ? "border-amber-400/40 bg-amber-400/15 text-amber-200"
                  : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground",
                !replaying && (d.logs?.length ?? 0) === 0 && "cursor-not-allowed opacity-40",
              )}
            >
              {replaying ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {replaying ? "Stop replay" : "Replay last run"}
            </button>
            <p className="text-xs text-muted-foreground">
              {replaying
                ? `Replaying ${replay.total} real log lines — line ${replay.logs.length} of ${replay.total}. Nothing is simulated.`
                : "Plays the crew's last real run back slowly enough to record."}
            </p>
          </div>

          {/* ── Counters + spend ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  AI credits burned
                </p>
                <Coins className="h-4 w-4 text-amber-400" />
              </div>
              <p className="mt-2 font-display text-2xl font-bold tabular-nums">
                {formatCompact(Math.round(d.usage.tokens * scale))} <span className="text-sm font-normal text-muted-foreground">tokens</span>
              </p>
              <p className="text-xs text-muted-foreground">
                ≈ {formatGbp(d.usage.estCostGbp)} {d.usage.sinceLabel}
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Made today
                </p>
                <Zap className="h-4 w-4 text-violet-400" />
              </div>
              <p className="mt-2 font-display text-2xl font-bold tabular-nums">{Math.round(d.counters.generatedToday * scale)}</p>
              <p className="text-xs text-muted-foreground">{d.counters.rendersToday} rendered</p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Upload quota
                </p>
                <UploadCloud className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="mt-2 font-display text-2xl font-bold">
                {d.counters.uploadsToday}
                <span className="text-sm font-normal text-muted-foreground"> / {d.counters.uploadQuota} today</span>
              </p>
              <Progress
                value={(d.counters.uploadsToday / d.counters.uploadQuota) * 100}
                className="mt-2 h-1.5"
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Queue depth
                </p>
                <ListTodo className="h-4 w-4 text-blue-400" />
              </div>
              <p className="mt-2 font-display text-2xl font-bold">{d.counters.queueDepth}</p>
              <p className="text-xs text-muted-foreground">jobs waiting</p>
            </motion.div>
          </div>

          {/* ── Live terminal ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass overflow-hidden rounded-2xl"
          >
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
              <Activity className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Terminal
              </span>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className={cn(
                    "h-1.5 w-1.5 animate-pulse-glow rounded-full",
                    replay.active ? "bg-amber-400" : "bg-emerald-400",
                  )}
                />
                {replay.active ? "replay" : "live"}
              </span>
            </div>
            <div
              ref={terminalRef}
              className="max-h-80 space-y-0.5 overflow-y-auto p-4 font-mono text-[11.5px] leading-relaxed"
            >
              {logs.length === 0 && (
                <p className="text-muted-foreground">No activity yet — kick off a project and watch the crew go.</p>
              )}
              {logs.map((log, i) => (
                <div key={`${log.atMs}-${i}`} className="flex gap-2">
                  <span className="shrink-0 text-zinc-500">
                    {new Date(log.atMs).toLocaleTimeString("en-GB", { hour12: false })}
                  </span>
                  <span className={cn("shrink-0 font-semibold", LOG_COLORS[log.agent])}>
                    {AGENT_META[log.agent as AgentKey]?.name ?? "system"}
                  </span>
                  <span className="text-foreground/85">{log.line}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
}
