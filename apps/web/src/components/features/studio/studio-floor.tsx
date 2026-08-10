"use client";

/**
 * StudioFloor — a top-down 2D map of the AI crew's facility.
 *
 * Plan view, not isometric: rooms are axis-aligned rectangles ringed by a thick
 * emissive border, sitting on a near-black void and joined by tan corridors.
 * Everything inside a room is drawn as a top-down silhouette — dark bodies
 * wearing thin bright strips — which is what makes a flat rectangle read as
 * lit machinery rather than a coloured box.
 *
 * Coordinates are plain design pixels (see `SCENE_W`/`SCENE_H`); the whole
 * scene scales to fit its container. Robots are absolutely positioned sprites
 * driven by motion values, wandering inside their own room. They do not walk
 * between rooms: the only honest routes are the corridors, and a robot cutting
 * across the void to reach one would look like a bug. The job packet is what
 * travels — and it travels along the corridors, which is the real story anyway.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

export type AgentKey = "writer" | "voice" | "render" | "upload" | "analyst";

export interface FloorAgent {
  key: AgentKey;
  status: "idle" | "working" | "queued";
  task: string | null;
  progress: number | null;
}

// ── Scene geometry ───────────────────────────────────────────────────────────

const SCENE_W = 880;
const SCENE_H = 560;

/** Upper bound on scale-to-fill, so an ultrawide window does not over-zoom. */
const MAX_SCALE = 1.55;

/** 3 × 2 grid of rooms with corridor gaps between them. */
const MARGIN = 24;
const GAP = 44;
const COL_W = (SCENE_W - MARGIN * 2 - GAP * 2) / 3; // 248
const ROW_H = (SCENE_H - MARGIN * 2 - GAP) / 2; // 234

const COL_X = [MARGIN, MARGIN + COL_W + GAP, MARGIN + (COL_W + GAP) * 2];
const ROW_Y = [MARGIN, MARGIN + ROW_H + GAP];

/** Corridor band width. */
const CORRIDOR = 30;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function cell(col: number, row: number): Rect {
  return { x: COL_X[col], y: ROW_Y[row], w: COL_W, h: ROW_H };
}

function centre(r: Rect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// ── Rooms ────────────────────────────────────────────────────────────────────

type Feature = "ring" | "pad" | "tower" | "spire" | "belt" | "pool";

interface Room {
  /** null for the hub, which has no agent of its own. */
  key: AgentKey | null;
  label: string;
  rect: Rect;
  hue: string;
  feature: Feature;
  /** Indices into SLOTS — which perimeter bays hold machinery. */
  props: number[];
  /** Indices into SLOTS — which hold foliage instead. */
  plants: number[];
}

/**
 * Perimeter bays as fractions of a room's size. Machinery and planting both
 * draw from this one list so nothing ever lands on top of anything else, and
 * each room picks a different subset to avoid five identical rooms.
 */
const SLOTS: [number, number, number, number][] = [
  /* 0 */ [0.08, 0.06, 0.17, 0.11],
  /* 1 */ [0.3, 0.06, 0.22, 0.09],
  /* 2 */ [0.58, 0.06, 0.15, 0.11],
  /* 3 */ [0.79, 0.06, 0.13, 0.1],
  /* 4 */ [0.05, 0.24, 0.11, 0.17],
  /* 5 */ [0.05, 0.46, 0.1, 0.21],
  /* 6 */ [0.06, 0.73, 0.12, 0.16],
  /* 7 */ [0.84, 0.22, 0.11, 0.19],
  /* 8 */ [0.85, 0.47, 0.1, 0.18],
  /* 9 */ [0.83, 0.71, 0.12, 0.18],
  /* 10 */ [0.22, 0.83, 0.2, 0.1],
  /* 11 */ [0.5, 0.84, 0.17, 0.09],
  /* 12 */ [0.72, 0.83, 0.13, 0.1],
];

const ROOMS: Room[] = [
  {
    key: "writer",
    label: "SCRIPT DESK",
    rect: cell(0, 0),
    hue: "140 80% 50%",
    feature: "pad",
    props: [0, 1, 4, 7, 10],
    plants: [3, 6, 9],
  },
  {
    key: "voice",
    label: "VOICE BOOTH",
    rect: cell(1, 0),
    hue: "42 95% 55%",
    feature: "tower",
    props: [1, 2, 5, 8, 11],
    plants: [0, 4, 12],
  },
  {
    key: "render",
    label: "RENDER BAY",
    rect: cell(2, 0),
    hue: "190 90% 55%",
    feature: "spire",
    props: [0, 2, 3, 6, 9, 11],
    plants: [5, 10],
  },
  {
    key: "analyst",
    label: "STATS WALL",
    rect: cell(0, 1),
    hue: "350 85% 62%",
    feature: "pool",
    props: [1, 3, 5, 9, 12],
    plants: [0, 6, 10],
  },
  {
    key: null,
    label: "THE BRIDGE",
    rect: cell(1, 1),
    hue: "22 95% 55%",
    feature: "ring",
    props: [0, 3, 4, 9],
    plants: [1, 2, 6, 7, 10, 12],
  },
  {
    key: "upload",
    label: "UPLOAD DOCK",
    rect: cell(2, 1),
    hue: "280 85% 64%",
    feature: "belt",
    props: [0, 2, 4, 8, 10, 12],
    plants: [3, 6],
  },
];

const ROOM_BY_KEY = Object.fromEntries(
  ROOMS.filter((r) => r.key).map((r) => [r.key as AgentKey, r]),
) as Record<AgentKey, Room>;

/**
 * Stations on the floor. The HUD denominator, deliberately NOT `agents.length`:
 * that goes to zero while the run is loading, and "0 / 0 agents active" reads
 * as a broken floor rather than an idle one.
 */
const CREW_SIZE = ROOMS.filter((r) => r.key).length;

const AGENT_NAMES: Record<AgentKey, string> = {
  writer: "Quill",
  voice: "George",
  render: "Bay-1",
  upload: "Dock",
  analyst: "Ledger",
};

const AGENT_EMOJI: Record<AgentKey, string> = {
  writer: "✍️",
  voice: "🎙️",
  render: "🎬",
  upload: "📤",
  analyst: "📊",
};

/** Corridors, as plain bands. Drawn under the rooms' glow. */
const CORRIDORS: Rect[] = [
  // horizontal, top row
  { x: COL_X[0] + COL_W, y: ROW_Y[0] + ROW_H / 2 - CORRIDOR / 2, w: GAP, h: CORRIDOR },
  { x: COL_X[1] + COL_W, y: ROW_Y[0] + ROW_H / 2 - CORRIDOR / 2, w: GAP, h: CORRIDOR },
  // horizontal, bottom row
  { x: COL_X[0] + COL_W, y: ROW_Y[1] + ROW_H / 2 - CORRIDOR / 2, w: GAP, h: CORRIDOR },
  { x: COL_X[1] + COL_W, y: ROW_Y[1] + ROW_H / 2 - CORRIDOR / 2, w: GAP, h: CORRIDOR },
  // vertical, one per column
  { x: COL_X[0] + COL_W / 2 - CORRIDOR / 2, y: ROW_Y[0] + ROW_H, w: CORRIDOR, h: GAP },
  { x: COL_X[1] + COL_W / 2 - CORRIDOR / 2, y: ROW_Y[0] + ROW_H, w: CORRIDOR, h: GAP },
  { x: COL_X[2] + COL_W / 2 - CORRIDOR / 2, y: ROW_Y[0] + ROW_H, w: CORRIDOR, h: GAP },
];

/** The route a job takes, as room keys. Every leg follows a real corridor. */
const PIPELINE: AgentKey[] = ["writer", "voice", "render", "upload"];

// ── Room chrome ──────────────────────────────────────────────────────────────

function slotRect(room: Rect, slot: number): Rect {
  const [fx, fy, fw, fh] = SLOTS[slot];
  return { x: room.x + fx * room.w, y: room.y + fy * room.h, w: fw * room.w, h: fh * room.h };
}

/** Top-down machinery: dark body, lighter cap, one emissive strip. */
function Machine({ r, hue }: { r: Rect; hue: string }) {
  const horizontal = r.w >= r.h;
  return (
    <g>
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx="3"
        fill="hsl(215 14% 15%)"
        stroke="hsl(215 12% 26%)"
        strokeWidth="1"
      />
      {/* Inset panel — reads as the machine's working surface from above. */}
      <rect
        x={r.x + 2.5}
        y={r.y + 2.5}
        width={Math.max(0, r.w - 5)}
        height={Math.max(0, r.h - 5)}
        rx="2"
        fill="hsl(215 13% 21%)"
      />
      {/* The emissive strip. Everything else here is grey; this is the only
          colour, which is why the machine reads as powered. */}
      <g filter="url(#bloom)">
        {horizontal ? (
          <line
            x1={r.x + r.w * 0.18}
            y1={r.y + r.h * 0.72}
            x2={r.x + r.w * 0.82}
            y2={r.y + r.h * 0.72}
            stroke={`hsl(${hue} / 0.9)`}
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : (
          <line
            x1={r.x + r.w * 0.72}
            y1={r.y + r.h * 0.18}
            x2={r.x + r.w * 0.72}
            y2={r.y + r.h * 0.82}
            stroke={`hsl(${hue} / 0.9)`}
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
      </g>
    </g>
  );
}

/** Foliage: overlapping discs, seen from directly above. */
function Foliage({ r }: { r: Rect }) {
  const c = centre(r);
  const rad = Math.min(r.w, r.h) / 2;
  const blobs: [number, number, number][] = [
    [-rad * 0.45, -rad * 0.25, rad * 0.62],
    [rad * 0.4, -rad * 0.35, rad * 0.5],
    [rad * 0.1, rad * 0.4, rad * 0.58],
    [-rad * 0.3, rad * 0.45, rad * 0.42],
  ];
  return (
    <g>
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx="3"
        fill="hsl(200 10% 17%)"
        stroke="hsl(200 10% 24%)"
        strokeWidth="1"
      />
      {blobs.map(([dx, dy, rr], i) => (
        <circle
          key={i}
          cx={c.x + dx}
          cy={c.y + dy}
          r={rr}
          fill={i % 2 === 0 ? "hsl(128 42% 26%)" : "hsl(112 48% 34%)"}
        />
      ))}
    </g>
  );
}

/** The showpiece in the middle of each room. */
function CentreFeature({ room, lit }: { room: Room; lit: boolean }) {
  const c = centre(room.rect);
  const hue = room.hue;
  const glow = lit ? 1 : 0.55;

  switch (room.feature) {
    case "ring":
      return (
        <g filter="url(#bloom)" opacity={glow}>
          <circle cx={c.x} cy={c.y} r="42" fill="none" stroke={`hsl(${hue} / 0.35)`} strokeWidth="9" />
          <circle cx={c.x} cy={c.y} r="42" fill="none" stroke={`hsl(${hue} / 0.95)`} strokeWidth="2" />
          <circle cx={c.x} cy={c.y} r="24" fill={`hsl(${hue} / 0.5)`} />
          <circle cx={c.x} cy={c.y} r="12" fill={`hsl(${hue} / 0.95)`} />
          {[0, 60, 120, 180, 240, 300].map((deg) => {
            const rad = (deg * Math.PI) / 180;
            return (
              <line
                key={deg}
                x1={c.x + Math.cos(rad) * 44}
                y1={c.y + Math.sin(rad) * 44}
                x2={c.x + Math.cos(rad) * 62}
                y2={c.y + Math.sin(rad) * 62}
                stroke={`hsl(${hue} / 0.8)`}
                strokeWidth="3"
                strokeLinecap="round"
              />
            );
          })}
        </g>
      );
    case "pad":
      return (
        <g opacity={glow}>
          <rect
            x={c.x - 44}
            y={c.y - 26}
            width="88"
            height="52"
            rx="4"
            fill="hsl(215 14% 15%)"
            stroke="hsl(215 12% 28%)"
          />
          <g filter="url(#bloom)">
            <rect x={c.x - 36} y={c.y - 19} width="72" height="38" rx="3" fill={`hsl(${hue} / 0.85)`} />
          </g>
        </g>
      );
    case "tower":
      return (
        <g opacity={glow}>
          <circle cx={c.x} cy={c.y} r="38" fill="none" stroke={`hsl(${hue} / 0.3)`} strokeWidth="6" />
          <circle cx={c.x} cy={c.y} r="26" fill="hsl(215 14% 15%)" stroke="hsl(215 12% 28%)" />
          <g filter="url(#bloom)">
            <circle cx={c.x} cy={c.y} r="13" fill={`hsl(${hue} / 0.9)`} />
            <circle cx={c.x} cy={c.y} r="26" fill="none" stroke={`hsl(${hue} / 0.85)`} strokeWidth="1.6" />
          </g>
        </g>
      );
    case "spire":
      return (
        <g opacity={glow}>
          <circle cx={c.x} cy={c.y} r="34" fill="hsl(215 14% 15%)" stroke="hsl(215 12% 28%)" />
          <g filter="url(#bloom)">
            {[0, 90, 180, 270].map((deg) => {
              const rad = (deg * Math.PI) / 180;
              return (
                <line
                  key={deg}
                  x1={c.x + Math.cos(rad) * 8}
                  y1={c.y + Math.sin(rad) * 8}
                  x2={c.x + Math.cos(rad) * 30}
                  y2={c.y + Math.sin(rad) * 30}
                  stroke={`hsl(${hue} / 0.9)`}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              );
            })}
            <circle cx={c.x} cy={c.y} r="9" fill={`hsl(${hue} / 0.95)`} />
          </g>
        </g>
      );
    case "belt":
      return (
        <g opacity={glow}>
          <rect
            x={c.x - 50}
            y={c.y - 28}
            width="100"
            height="56"
            rx="4"
            fill="hsl(215 14% 15%)"
            stroke="hsl(215 12% 28%)"
          />
          <g filter="url(#bloom)">
            {[-14, 0, 14].map((dy) => (
              <line
                key={dy}
                x1={c.x - 40}
                y1={c.y + dy}
                x2={c.x + 40}
                y2={c.y + dy}
                stroke={`hsl(${hue} / 0.85)`}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            ))}
          </g>
        </g>
      );
    case "pool":
      return (
        <g opacity={glow}>
          <rect
            x={c.x - 46}
            y={c.y - 30}
            width="92"
            height="60"
            rx="16"
            fill="hsl(190 55% 22%)"
            stroke="hsl(190 40% 32%)"
          />
          <g filter="url(#bloom)">
            <rect
              x={c.x - 38}
              y={c.y - 23}
              width="76"
              height="46"
              rx="13"
              fill="hsl(186 80% 45% / 0.55)"
            />
          </g>
          <circle cx={c.x - 20} cy={c.y - 6} r="5" fill="hsl(186 85% 70% / 0.5)" />
          <circle cx={c.x + 16} cy={c.y + 9} r="4" fill="hsl(186 85% 70% / 0.4)" />
        </g>
      );
  }
}

function RoomShell({ room, lit }: { room: Room; lit: boolean }) {
  const { x, y, w, h } = room.rect;
  const hue = room.hue;
  const seams = useMemo(() => {
    const lines: { key: string; d: string }[] = [];
    const step = 31;
    for (let gx = x + step; gx < x + w - 2; gx += step) {
      lines.push({ key: `v${gx}`, d: `M${gx},${y + 4} L${gx},${y + h - 4}` });
    }
    for (let gy = y + step; gy < y + h - 2; gy += step) {
      lines.push({ key: `h${gy}`, d: `M${x + 4},${gy} L${x + w - 4},${gy}` });
    }
    return lines;
  }, [x, y, w, h]);

  return (
    <g>
      {/* Floor */}
      <rect x={x} y={y} width={w} height={h} rx="4" fill="hsl(213 11% 30%)" />
      {seams.map((l) => (
        <path key={l.key} d={l.d} stroke="hsl(213 12% 24% / 0.85)" strokeWidth="1" fill="none" />
      ))}
      {/* A darker apron just inside the wall, as in the reference — it stops the
          floor reading as one flat fill and gives the machinery something to
          sit against. */}
      <rect
        x={x + 7}
        y={y + 7}
        width={w - 14}
        height={h - 14}
        rx="3"
        fill="none"
        stroke="hsl(213 12% 25%)"
        strokeWidth="9"
        opacity="0.55"
      />

      {/* Zone markers scattered on the floor */}
      {[
        [0.24, 0.36],
        [0.74, 0.3],
        [0.36, 0.68],
        [0.66, 0.72],
      ].map(([fx, fy], i) => (
        <circle
          key={i}
          cx={x + fx * w}
          cy={y + fy * h}
          r="7"
          fill="none"
          stroke={`hsl(${hue} / 0.4)`}
          strokeWidth="1.5"
        />
      ))}

      <CentreFeature room={room} lit={lit} />

      {room.props.map((s) => (
        <Machine key={`m${s}`} r={slotRect(room.rect, s)} hue={hue} />
      ))}
      {room.plants.map((s) => (
        <Foliage key={`p${s}`} r={slotRect(room.rect, s)} />
      ))}

      {/* The neon wall. Drawn last so it sits over everything inside. */}
      <g filter="url(#bloom)">
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx="4"
          fill="none"
          stroke={`hsl(${hue} / ${lit ? 0.95 : 0.6})`}
          strokeWidth="3.5"
        />
      </g>
      {/* Corner markers */}
      {[
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ].map(([cx, cy], i) => (
        <rect
          key={i}
          x={cx - 5}
          y={cy - 5}
          width="10"
          height="10"
          rx="1.5"
          fill={`hsl(${hue} / ${lit ? 1 : 0.7})`}
        />
      ))}

      {/* Name plate, sitting on the bottom wall. This is the room's only name —
          a second floating chip above the room said the same word twice. The
          dot carries the working state, as the neon wall already does. */}
      <rect
        x={x + 12}
        y={y + h - 9}
        width={room.label.length * 6.2 + 26}
        height="15"
        rx="2"
        fill="hsl(24 18% 6%)"
      />
      <circle cx={x + 21} cy={y + h - 1.5} r={lit ? 3 : 2.4} fill={`hsl(${hue} / ${lit ? 1 : 0.5})`} />
      <text
        x={x + 30}
        y={y + h + 2}
        fill={`hsl(${hue} / ${lit ? 1 : 0.72})`}
        fontSize="9.5"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        letterSpacing="1.2"
      >
        {room.label}
      </text>
    </g>
  );
}

function Scenery({ workingKeys }: { workingKeys: Set<AgentKey> }) {
  return (
    <svg viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        {/* Bloom: what makes a stroke read as emitted light rather than paint.
            Kept tight — a wide blur turns the map into haze and loses the
            crispness the reference depends on. */}
        <filter id="bloom" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="2.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Void */}
      <rect x="0" y="0" width={SCENE_W} height={SCENE_H} fill="hsl(24 22% 4%)" />

      {/* Corridors, under the rooms */}
      {CORRIDORS.map((c, i) => (
        <g key={i}>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="hsl(20 42% 56%)" />
          <rect
            x={c.x}
            y={c.y}
            width={c.w}
            height={c.h}
            fill="none"
            stroke="hsl(20 35% 40%)"
            strokeWidth="1"
          />
        </g>
      ))}

      {ROOMS.map((room) => (
        <RoomShell
          key={room.label}
          room={room}
          lit={room.key === null ? workingKeys.size > 0 : workingKeys.has(room.key)}
        />
      ))}
    </svg>
  );
}

// ── Robots ───────────────────────────────────────────────────────────────────

const WALK_SPEED = 46; // design px / second

/** Where a robot stands to work, and the spots it drifts to when it is not. */
function workSpot(room: Room): { x: number; y: number } {
  const c = centre(room.rect);
  return { x: c.x - 4, y: c.y + 46 };
}

function idleSpots(room: Room): { x: number; y: number }[] {
  const { x, y, w, h } = room.rect;
  return [
    { x: x + w * 0.26, y: y + h * 0.36 },
    { x: x + w * 0.74, y: y + h * 0.32 },
    { x: x + w * 0.38, y: y + h * 0.68 },
    { x: x + w * 0.66, y: y + h * 0.7 },
  ];
}

interface RobotProps {
  agent: FloorAgent;
  entryDelay: number;
  reduced: boolean;
}

function Robot({ agent, entryDelay, reduced }: RobotProps) {
  const room = ROOM_BY_KEY[agent.key];
  const home = workSpot(room);
  const x = useMotionValue(home.x);
  const y = useMotionValue(home.y);
  const zIndex = useTransform(y, (v) => 100 + Math.round(v));
  const [mode, setMode] = useState<"idle" | "walk" | "work">("idle");
  const [facing, setFacing] = useState(1);
  const statusRef = useRef(agent.status);
  statusRef.current = agent.status;

  useEffect(() => {
    if (reduced) return; // static placement — no wandering under reduced motion
    let alive = true;
    let controls: { stop: () => void }[] = [];

    const walkTo = async (tx: number, ty: number) => {
      const dx = tx - x.get();
      const dy = ty - y.get();
      const dist = Math.hypot(dx, dy);
      if (dist < 4) return;
      if (Math.abs(dx) > 6) setFacing(dx < 0 ? -1 : 1);
      setMode("walk");
      const duration = dist / WALK_SPEED;
      const opts = { duration, ease: [0.45, 0.05, 0.55, 0.95] as const };
      const a = animate(x, tx, opts);
      const b = animate(y, ty, opts);
      controls = [a, b];
      await Promise.all([a, b]);
    };

    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

    // A call, not a direct comparison: the ref mutates behind TypeScript's
    // back, so an inline `statusRef.current === "working"` narrows the type in
    // the else branch and the later re-check stops compiling.
    const isWorking = () => statusRef.current === "working";

    (async () => {
      await pause(600 + entryDelay * 1000);
      const spots = idleSpots(room);
      while (alive) {
        if (isWorking()) {
          // Clock in: walk to the centre feature and work until status changes.
          const spot = workSpot(room);
          await walkTo(spot.x, spot.y);
          if (!alive) break;
          setMode("work");
          while (alive && isWorking()) await pause(400);
        } else {
          setMode("idle");
          await pause(1200 + Math.random() * 3200);
          if (!alive || isWorking()) continue;
          const target = spots[Math.floor(Math.random() * spots.length)];
          const jitter = () => (Math.random() - 0.5) * 18;
          await walkTo(target.x + jitter(), target.y + jitter());
          if (!alive) break;
          setMode("idle");
        }
      }
    })();

    return () => {
      alive = false;
      controls.forEach((c) => c.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // Snap out of "work" pose the moment the job ends.
  useEffect(() => {
    if (agent.status !== "working" && mode === "work") setMode("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.status]);

  const working = agent.status === "working";

  return (
    <motion.div
      className="absolute left-0 top-0"
      style={{ x, y, zIndex }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, delay: entryDelay, ease: [0.23, 1, 0.32, 1] }}
    >
      <div className="relative" style={{ transform: "translate(-50%, -50%)" }}>
        {/* Task bubble */}
        {working && agent.task && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: "bottom center" }}
            className="absolute -top-[74px] left-1/2 z-10 w-40 -translate-x-1/2 rounded-xl border border-primary/30 bg-popover/95 px-2.5 py-1.5 text-center shadow-xl backdrop-blur-xl"
          >
            <p className="truncate text-[10.5px] font-medium">{agent.task}</p>
            {agent.progress !== null && <Progress value={agent.progress} className="mt-1 h-1" />}
            <span className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-primary/30 bg-popover/95" />
          </motion.div>
        )}

        {/* Drop shadow on the floor, directly under the sprite (plan view). */}
        <div className="absolute left-1/2 top-1/2 h-4 w-8 -translate-x-1/2 -translate-y-1/4 rounded-[100%] bg-black/60 blur-[3px]" />

        <motion.div
          animate={{ scaleX: facing }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className="relative"
        >
          <motion.div
            animate={
              reduced
                ? { y: 0 }
                : mode === "walk"
                  ? { y: [0, -3, 0] }
                  : mode === "work"
                    ? { y: [0, -4, 0] }
                    : { y: [0, -1.5, 0] }
            }
            transition={
              reduced
                ? { duration: 0 }
                : {
                    duration: mode === "walk" ? 0.34 : mode === "work" ? 1.1 : 3.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }
            }
            className={cn(
              "overflow-hidden rounded-lg ring-1 transition-shadow duration-300",
              working ? "ring-primary/70 glow-primary" : "ring-border/50 saturate-[0.8]",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/studio/${agent.key}.png`}
              alt={AGENT_NAMES[agent.key]}
              draggable={false}
              className="h-11 w-11 object-cover"
            />
          </motion.div>
        </motion.div>

        {/* Name tag. Carries the job emoji too, which is the identity the
            removed floating room chip used to supply. */}
        <div className="mt-0.5 flex items-center justify-center gap-1 whitespace-nowrap">
          <span className="text-[9px] leading-none">{AGENT_EMOJI[agent.key]}</span>
          <span className="font-display text-[9.5px] font-bold text-foreground/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
            {AGENT_NAMES[agent.key]}
          </span>
          {working && <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse-glow" />}
        </div>
      </div>
    </motion.div>
  );
}

// ── The job packet riding the corridors ──────────────────────────────────────

/**
 * Waypoints for one job: room centre → corridor → next room centre. The route
 * writer → voice → render → upload happens to run along the top row and then
 * down the right-hand column, so every leg is an axis-aligned run down a real
 * corridor. Adding a station off that path would need an actual route search.
 */
function JobPacket({ active }: { active: boolean }) {
  const points = useMemo(() => PIPELINE.map((k) => centre(ROOM_BY_KEY[k].rect)), []);
  if (!active) return null;
  return (
    <motion.div
      className="absolute left-0 top-0 z-[60] h-3 w-3 rounded-sm bg-primary shadow-[0_0_14px_4px_hsl(263_70%_60%/0.6)]"
      animate={{
        x: points.map((p) => p.x - 6),
        y: points.map((p) => p.y - 6),
        opacity: [0, 1, 1, 1, 1, 0],
      }}
      transition={{
        duration: 7,
        times: [0, 0.05, 0.35, 0.65, 0.95, 1],
        repeat: Infinity,
        ease: "linear",
        repeatDelay: 1.2,
      }}
    />
  );
}

// ── The floor itself ─────────────────────────────────────────────────────────

export function StudioFloor({
  agents,
  queueDepth,
}: {
  agents: FloorAgent[];
  queueDepth: number;
}) {
  const reduced = useReducedMotion() ?? false;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Fill the card rather than sitting in the middle of it. Upscaling is safe:
    // the map is SVG and the robot sprites are 1024px sources drawn at 44. The
    // cap stops an ultrawide window blowing the map up past its detail.
    const fit = () => setScale(Math.min(MAX_SCALE, el.clientWidth / SCENE_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const working = agents.filter((a) => a.status === "working");
  const workingKeys = useMemo(
    () => new Set(working.map((a) => a.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [working.map((a) => a.key).join(",")],
  );
  const activeCount = working.length;
  const currentTask = working.find((a) => a.task)?.task ?? null;

  return (
    <div className="glass relative overflow-hidden rounded-3xl">
      {/* HUD strip — the reference's status bar, fed by the same numbers the
          rest of the page shows. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border/50 bg-background/50 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground backdrop-blur-md">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              activeCount > 0 ? "animate-pulse-glow bg-emerald-400" : "bg-zinc-600",
            )}
          />
          <span className="text-foreground/85">
            {activeCount} / {CREW_SIZE}
          </span>
          agents active
        </span>
        <span>
          queue <span className="text-foreground/85">{queueDepth}</span>
        </span>
        <span className="min-w-0 flex-1 truncate normal-case tracking-normal text-muted-foreground/70">
          {currentTask ?? "idle — crew on standby"}
        </span>
      </div>

      <div ref={wrapRef} className="relative w-full" style={{ height: SCENE_H * scale }}>
        <div
          className="absolute left-1/2 top-0 origin-top"
          style={{ width: SCENE_W, height: SCENE_H, transform: `translateX(-50%) scale(${scale})` }}
        >
          <Scenery workingKeys={workingKeys} />

          {!reduced && <JobPacket active={activeCount > 0} />}

          {agents.map((agent, i) => (
            <Robot key={agent.key} agent={agent} entryDelay={i * 0.06} reduced={reduced} />
          ))}
        </div>
      </div>
    </div>
  );
}
