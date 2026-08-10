"use client";

/**
 * Replay of the crew's last real run, at a pace you can film.
 *
 * A generation-to-upload cycle takes under a minute end to end, and the floor
 * then sits on standby — which is the correct thing for it to show and useless
 * to record. This walks the REAL log lines the API already returned, one at a
 * time, deriving which agent is working from each line. The robots walk, the
 * stations light up and the terminal fills exactly as they did, just slowly
 * enough to watch.
 *
 * It is replay, not simulation: every line and timestamp is one the pipeline
 * actually emitted. Nothing is invented. The UI badges it REPLAY throughout so
 * it can never be mistaken for live activity — the whole appeal of showing this
 * is that it is real, and a viewer who later discovers a mock-up would be right
 * to discount everything else too.
 */

import { useEffect, useMemo, useRef, useState } from "react";

export type AgentKey = "writer" | "voice" | "render" | "upload" | "analyst";

export interface FloorLog {
  atMs: number;
  agent: AgentKey | "system";
  job: string;
  line: string;
}

export interface FloorAgentState {
  key: AgentKey;
  status: "idle" | "working" | "queued";
  task: string | null;
  progress: number | null;
}

const ALL_AGENTS: AgentKey[] = ["writer", "voice", "render", "upload", "analyst"];

/** Milliseconds each log line holds the screen. Slow enough to read a line. */
const STEP_MS = 900;

/** Beat of stillness at the end before looping, so the last state registers. */
const TAIL_STEPS = 3;

export interface ReplayResult {
  active: boolean;
  /** Agent states derived from the current line — feed straight to StudioFloor. */
  agents: FloorAgentState[];
  /** Logs revealed so far. */
  logs: FloorLog[];
  /** 0..1 through the run, for counter count-ups. */
  progress: number;
  /** Number of lines in the source run; 0 when there is nothing to replay. */
  total: number;
}

export function useFloorReplay(
  sourceLogs: FloorLog[] | undefined,
  active: boolean,
): ReplayResult {
  // Freeze the source when replay starts. Without this the 2.5s poll would
  // swap the array mid-playback and the cursor would point at a different run.
  //
  // STATE, not a ref: a ref mutation does not re-render, so `total` would keep
  // the value it had before the effect ran — zero — and the replay would report
  // "0 of 0" forever while sitting on a full log array.
  const [frozen, setFrozen] = useState<FloorLog[]>([]);
  const [cursor, setCursor] = useState(0);
  const latest = useRef<FloorLog[] | undefined>(sourceLogs);
  latest.current = sourceLogs;

  useEffect(() => {
    if (active) {
      setFrozen([...(latest.current ?? [])]);
      setCursor(0);
    } else {
      setFrozen([]);
    }
  }, [active]);

  const total = active ? frozen.length : 0;

  useEffect(() => {
    if (!active || total === 0) return;
    const id = setInterval(() => {
      setCursor((c) => (c + 1) % (total + TAIL_STEPS));
    }, STEP_MS);
    return () => clearInterval(id);
  }, [active, total]);

  return useMemo(() => {
    if (!active || total === 0) {
      return { active: false, agents: [], logs: [], progress: 0, total: 0 };
    }
    const shown = frozen.slice(0, Math.min(cursor + 1, total));
    const current = shown[shown.length - 1];
    // The agent on the newest line is at their station; anyone who has already
    // had a line this run is queued (they are part of this job), the rest idle.
    const seen = new Set(shown.map((l) => l.agent));
    const agents: FloorAgentState[] = ALL_AGENTS.map((key) => {
      if (current && current.agent === key && cursor < total) {
        return { key, status: "working", task: current.line, progress: null };
      }
      return {
        key,
        status: seen.has(key) ? "queued" : "idle",
        task: null,
        progress: null,
      };
    });
    return {
      active: true,
      agents,
      logs: shown,
      progress: Math.min(1, (cursor + 1) / total),
      total,
    };
  }, [active, cursor, total, frozen]);
}
