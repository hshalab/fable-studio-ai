"use client";

/**
 * StudioFloor — an isometric "tycoon sim" view of the AI crew.
 *
 * Classic 2:1 isometric projection (the same math as Theme Hospital / RCT):
 *   screen.x = (gx - gy) * TILE_W/2
 *   screen.y = (gx + gy) * TILE_H/2
 * The floor + walls + furniture are one SVG; the robots are absolutely
 * positioned sprites driven by motion values, walking waypoint-to-waypoint
 * with a state machine per robot. Depth = z-index from screen.y, exactly like
 * a sprite-sorted game. Everything animates transform/opacity only.
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

// ── Projection ───────────────────────────────────────────────────────────────

const TILE_W = 64;
const TILE_H = 32;
const GRID = 10;
const WALL_H = 86;

/** Design-space size; the whole scene scales to fit its container. */
const SCENE_W = TILE_W * GRID + 96; // 736
const SCENE_H = TILE_H * GRID + WALL_H + 120; // 526
const OX = SCENE_W / 2;
const OY = WALL_H + 34;

function iso(gx: number, gy: number): { x: number; y: number } {
  return {
    x: OX + ((gx - gy) * TILE_W) / 2,
    y: OY + ((gx + gy) * TILE_H) / 2,
  };
}

// ── Layout: stations, wander spots, props ────────────────────────────────────

interface Station {
  key: AgentKey;
  label: string;
  emoji: string;
  /** Where the furniture block sits. */
  at: [number, number];
  /** Where the robot stands to work (in front of the furniture). */
  standAt: [number, number];
  hue: string; // svg fill hue
  chip: string; // tailwind text color for the label chip
}

const STATIONS: Station[] = [
  { key: "writer", label: "Script Desk", emoji: "✍️", at: [2.2, 1.6], standAt: [3.1, 2.7], hue: "150 75% 50%", chip: "text-emerald-300" },
  { key: "voice", label: "Voice Booth", emoji: "🎙️", at: [7.4, 1.5], standAt: [6.5, 2.6], hue: "24 88% 56%",  chip: "text-orange-300" },
  { key: "render", label: "Render Bay", emoji: "🎬", at: [8.3, 5.4], standAt: [7.2, 5.9], hue: "195 85% 55%", chip: "text-cyan-300" },
  { key: "upload", label: "Upload Dock", emoji: "📤", at: [6.3, 8.3], standAt: [5.6, 7.2], hue: "150 75% 50%", chip: "text-emerald-300" },
  { key: "analyst", label: "Stats Wall", emoji: "📊", at: [1.5, 5.8], standAt: [2.6, 6.3], hue: "45 95% 58%",  chip: "text-amber-300" },
];

const STATION_BY_KEY = Object.fromEntries(STATIONS.map((s) => [s.key, s])) as Record<
  AgentKey,
  Station
>;

/** Shared hang-out spots for idle wandering. */
const WANDER_SPOTS: [number, number][] = [
  [4.8, 4.9], // lounge rug
  [3.4, 8.2], // coffee corner
  [8.2, 7.6],
  [4.6, 6.8],
  [5.6, 3.4],
];

const AGENT_NAMES: Record<AgentKey, string> = {
  writer: "Quill",
  voice: "George",
  render: "Bay-1",
  upload: "Dock",
  analyst: "Ledger",
};

/** Crates: [gx, gy, height]. Stacked against the back walls and in corners. */
const CRATES: [number, number, number][] = [
  [0.4, 0.5, 22], [1.0, 0.4, 16], [0.5, 1.2, 13],
  [8.9, 0.6, 20], [9.2, 1.4, 14],
  [0.6, 8.6, 18], [1.3, 9.1, 12],
  [9.0, 8.8, 17], [8.4, 9.3, 11],
  [4.9, 0.5, 15], [5.6, 0.4, 10],
];

const CRATE_HUES = [
  "24 85% 55%",   // amber
  "150 70% 48%",  // acid green
  "195 80% 55%",  // cyan
  "24 85% 55%",
  "263 70% 62%",  // a nod to the brand violet
];

/** Potted plants — the organic contrast the reference leans on heavily. */
const PLANTS: [number, number][] = [
  [1.9, 3.5], [7.9, 3.2], [2.2, 7.6], [7.4, 7.9], [5.1, 1.6],
];

/** Pipeline the job-packet travels when the crew is busy. */
const PIPELINE: AgentKey[] = ["writer", "voice", "render", "upload"];

// ── SVG scenery ──────────────────────────────────────────────────────────────

function diamondPoints(gx: number, gy: number, w = 1, h = 1): string {
  const a = iso(gx, gy);
  const b = iso(gx + w, gy);
  const c = iso(gx + w, gy + h);
  const d = iso(gx, gy + h);
  return `${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`;
}

/** Isometric box: floor diamond extruded upward — top + two visible faces. */
function IsoBox({
  gx,
  gy,
  w,
  d,
  h,
  hue,
  opacity = 1,
}: {
  gx: number;
  gy: number;
  w: number;
  d: number;
  h: number;
  hue: string;
  opacity?: number;
}) {
  const A = iso(gx, gy);
  const B = iso(gx + w, gy);
  const C = iso(gx + w, gy + d);
  const D = iso(gx, gy + d);
  const lift = (p: { x: number; y: number }) => `${p.x},${p.y - h}`;
  return (
    <g opacity={opacity}>
      {/* left face (D-C edge) */}
      <polygon
        points={`${D.x},${D.y} ${C.x},${C.y} ${lift(C)} ${lift(D)}`}
        fill={`hsl(${hue} / 0.28)`}
        stroke={`hsl(${hue} / 0.5)`}
        strokeWidth="1"
      />
      {/* right face (C-B edge) */}
      <polygon
        points={`${C.x},${C.y} ${B.x},${B.y} ${lift(B)} ${lift(C)}`}
        fill={`hsl(${hue} / 0.16)`}
        stroke={`hsl(${hue} / 0.5)`}
        strokeWidth="1"
      />
      {/* top face */}
      <polygon
        points={`${A.x},${A.y - h} ${B.x},${B.y - h} ${C.x},${C.y - h} ${D.x},${D.y - h}`}
        fill={`hsl(${hue} / 0.42)`}
        stroke={`hsl(${hue} / 0.75)`}
        strokeWidth="1"
      />
      {/* Emissive rim along the two front edges. This is the single detail
          that separates "lit machinery" from "coloured block": the reference
          facilities are dark bodies with thin bright strips, not filled
          shapes. Blurred through #bloom so it reads as light, not paint. */}
      <g filter="url(#bloom)">
        <line
          x1={D.x} y1={D.y - h} x2={C.x} y2={C.y - h}
          stroke={`hsl(${hue} / 0.95)`} strokeWidth="1.6" strokeLinecap="round"
        />
        <line
          x1={C.x} y1={C.y - h} x2={B.x} y2={B.y - h}
          stroke={`hsl(${hue} / 0.95)`} strokeWidth="1.6" strokeLinecap="round"
        />
      </g>
    </g>
  );
}

function Scenery() {
  const tiles = useMemo(() => {
    const cells: { key: string; points: string; dark: boolean }[] = [];
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        cells.push({ key: `${i}-${j}`, points: diamondPoints(i, j), dark: (i + j) % 2 === 0 });
      }
    }
    return cells;
  }, []);

  const c00 = iso(0, 0);
  const cG0 = iso(GRID, 0);
  const c0G = iso(0, GRID);
  const cGG = iso(GRID, GRID);

  return (
    <svg
      viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id="wallL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(228 20% 15% / 0.9)" />
          <stop offset="100%" stopColor="hsl(228 20% 8% / 0.5)" />
        </linearGradient>
        <linearGradient id="wallR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(228 18% 13% / 0.85)" />
          <stop offset="100%" stopColor="hsl(228 18% 7% / 0.45)" />
        </linearGradient>
        <radialGradient id="rug" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(150 80% 55% / 0.18)" />
          <stop offset="100%" stopColor="hsl(150 80% 55% / 0)" />
        </radialGradient>
        {/* Bloom: the glow that makes an edge read as emissive. Kept tight —
            a wide blur turns the whole floor into haze and kills the crispness
            the reference relies on. */}
        <filter id="bloom" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Walls (stand on the two back edges) */}
      <polygon
        points={`${c00.x},${c00.y} ${c0G.x},${c0G.y} ${c0G.x},${c0G.y - WALL_H} ${c00.x},${c00.y - WALL_H}`}
        fill="url(#wallL)"
        stroke="hsl(150 70% 55% / 0.28)"
        strokeWidth="1"
      />
      <polygon
        points={`${c00.x},${c00.y} ${cG0.x},${cG0.y} ${cG0.x},${cG0.y - WALL_H} ${c00.x},${c00.y - WALL_H}`}
        fill="url(#wallR)"
        stroke="hsl(150 70% 55% / 0.28)"
        strokeWidth="1"
      />
      {/* Wall art: brand plaque + kanban cards */}
      <g
        transform={`translate(${c00.x - 150} ${c00.y - WALL_H / 2 + 42}) skewY(-26.5)`}
      >
        <text
          x="0"
          y="0"
          fill="hsl(263 80% 78% / 0.8)"
          fontSize="15"
          fontWeight="700"
          letterSpacing="2"
          style={{ fontFamily: "var(--font-display, inherit)" }}
        >
          FABLE STUDIO
        </text>
      </g>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={c00.x + 46 + i * 34}
          y={c00.y - WALL_H + 40 + i * 17}
          width="26"
          height="18"
          rx="3"
          fill={`hsl(${[263, 330, 160][i]} 70% 62% / 0.4)`}
          stroke="hsl(0 0% 100% / 0.2)"
        />
      ))}

      {/* Floor */}
      <polygon
        points={`${c00.x},${c00.y} ${cG0.x},${cG0.y} ${cGG.x},${cGG.y} ${c0G.x},${c0G.y}`}
        fill="hsl(230 18% 7% / 0.96)"
      />
      {tiles.map((t) => (
        <polygon
          key={t.key}
          points={t.points}
          // Charcoal panelling. The old lilac tiles read as a diagram; a plant
          // floor is nearly black and gets its colour from what is ON it.
          fill={t.dark ? "hsl(228 16% 11% / 0.9)" : "hsl(228 14% 13% / 0.85)"}
          stroke="hsl(150 60% 55% / 0.07)"
          strokeWidth="1"
        />
      ))}

      {/* Lounge rug */}
      <ellipse
        cx={iso(4.8, 4.9).x}
        cy={iso(4.8, 4.9).y}
        rx="66"
        ry="33"
        fill="url(#rug)"
        stroke="hsl(263 70% 60% / 0.25)"
        strokeDasharray="4 5"
      />

      {/* Zone pads: a bright outlined footprint under every station. The
          reference marks its working areas on the floor this way, and it is
          what stops a dark facility reading as an empty room. */}
      {STATIONS.map((s) => (
        <polygon
          key={`pad-${s.key}`}
          points={diamondPoints(s.at[0] - 1.15, s.at[1] - 0.95, 2.3, 2.1)}
          fill={`hsl(${s.hue} / 0.05)`}
          stroke={`hsl(${s.hue} / 0.5)`}
          strokeWidth="1.2"
          strokeDasharray="7 6"
        />
      ))}

      {/* Station furniture */}
      {STATIONS.map((s) => (
        <IsoBox key={s.key} gx={s.at[0] - 0.75} gy={s.at[1] - 0.55} w={1.5} d={1.1} h={30} hue={s.hue} />
      ))}

      {/* Clutter. Density is most of what separates the reference from a
          diagram — crates stacked by the walls, cable runs between stations,
          planting softening the grey. Fixed positions, not random: this
          renders on the server too, and a random layout would hydrate
          differently from the markup React already sent. */}
      {CRATES.map((c, i) => (
        <IsoBox
          key={`crate-${i}`}
          gx={c[0]} gy={c[1]} w={0.55} d={0.55} h={c[2]}
          hue={CRATE_HUES[i % CRATE_HUES.length]}
          opacity={0.9}
        />
      ))}

      {/* Cable runs — thin emissive lines tracking the pipeline order. */}
      <g filter="url(#bloom)" opacity="0.55">
        {PIPELINE.slice(0, -1).map((key, i) => {
          const a = STATION_BY_KEY[key];
          const b = STATION_BY_KEY[PIPELINE[i + 1]];
          const p1 = iso(a.standAt[0], a.standAt[1]);
          const p2 = iso(b.standAt[0], b.standAt[1]);
          return (
            <line
              key={`cable-${key}`}
              x1={p1.x} y1={p1.y + 3} x2={p2.x} y2={p2.y + 3}
              stroke="hsl(150 80% 55% / 0.5)"
              strokeWidth="1.2"
              strokeDasharray="3 7"
            />
          );
        })}
      </g>

      {/* Planting */}
      {PLANTS.map((pt, i) => {
        const c = iso(pt[0], pt[1]);
        return (
          <g key={`plant-${i}`} transform={`translate(${c.x} ${c.y})`}>
            <ellipse cx="0" cy="0" rx="7" ry="3.5" fill="hsl(228 20% 5% / 0.55)" />
            <path
              d="M0,0 C-6,-7 -8,-13 -3,-16 M0,0 C5,-8 9,-12 4,-17 M0,0 C0,-8 1,-14 0,-19"
              fill="none"
              stroke="hsl(140 55% 45%)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </g>
        );
      })}
    </svg>
  );
}

// ── Robot sprite with a walking state machine ────────────────────────────────

const WALK_SPEED = 46; // design px / second

interface RobotProps {
  agent: FloorAgent;
  entryDelay: number;
  reduced: boolean;
}

function Robot({ agent, entryDelay, reduced }: RobotProps) {
  const station = STATION_BY_KEY[agent.key];
  const home = iso(station.standAt[0], station.standAt[1]);
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

    const pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    (async () => {
      await pause(600 + entryDelay * 1000);
      while (alive) {
        const working = statusRef.current === "working";
        if (working) {
          // Clock in: walk to the station and work until the status changes.
          const spot = iso(station.standAt[0], station.standAt[1]);
          await walkTo(spot.x, spot.y);
          if (!alive) break;
          setFacing(station.at[0] >= station.standAt[0] ? 1 : -1);
          setMode("work");
          while (alive && statusRef.current === "working") await pause(400);
        } else {
          // Off the clock: hang about like a tycoon citizen.
          setMode("idle");
          await pause(1200 + Math.random() * 3200);
          if (!alive || statusRef.current === "working") continue;
          const roll = Math.random();
          const [wx, wy] =
            roll < 0.4
              ? station.standAt
              : WANDER_SPOTS[Math.floor(Math.random() * WANDER_SPOTS.length)];
          const jitter = () => (Math.random() - 0.5) * 0.7;
          const target = iso(wx + jitter(), wy + jitter());
          await walkTo(target.x, target.y);
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
      <div className="relative" style={{ transform: "translateX(-50%)" }}>
        {/* Task bubble */}
        {working && agent.task && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            style={{ transformOrigin: "bottom center" }}
            className="absolute -top-[92px] left-1/2 z-10 w-40 -translate-x-1/2 rounded-xl border border-primary/30 bg-popover/95 px-2.5 py-1.5 text-center shadow-xl backdrop-blur-xl"
          >
            <p className="truncate text-[10.5px] font-medium">{agent.task}</p>
            {agent.progress !== null && <Progress value={agent.progress} className="mt-1 h-1" />}
            <span className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-primary/30 bg-popover/95" />
          </motion.div>
        )}

        {/* Sprite: outer flips direction, inner bobs */}
        <motion.div
          animate={{ scaleX: facing }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          className="relative -mt-[64px]"
        >
          <motion.div
            animate={
              reduced
                ? { y: 0 }
                : mode === "walk"
                  ? { y: [0, -4, 0] }
                  : mode === "work"
                    ? { y: [0, -6, 0] }
                    : { y: [0, -2, 0] }
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
              "overflow-hidden rounded-xl ring-1 transition-shadow duration-300",
              working ? "ring-primary/60 glow-primary" : "ring-border/60 saturate-[0.85]",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/studio/${agent.key}.png`}
              alt={AGENT_NAMES[agent.key]}
              draggable={false}
              className="h-14 w-14 object-cover"
            />
          </motion.div>
        </motion.div>

        {/* Ground shadow */}
        <div
          className={cn(
            "mx-auto -mt-1 h-2 rounded-[100%] bg-black/55 blur-[2.5px] transition-all duration-300",
            mode === "walk" ? "w-9 opacity-60" : working ? "w-11 opacity-90" : "w-10 opacity-50",
          )}
        />

        {/* Name tag */}
        <div className="mt-1 flex items-center justify-center gap-1">
          <span
            className={cn(
              "h-1 w-1 rounded-full",
              working ? "animate-pulse-glow bg-emerald-400" : "bg-zinc-600",
            )}
          />
          <span className="font-display text-[10px] font-bold text-foreground/90">
            {AGENT_NAMES[agent.key]}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ── The glowing job packet riding the pipeline ───────────────────────────────

function JobPacket({ active }: { active: boolean }) {
  const points = useMemo(() => PIPELINE.map((k) => iso(...STATION_BY_KEY[k].at)), []);
  if (!active) return null;
  return (
    <motion.div
      className="absolute left-0 top-0 z-[60] h-2.5 w-2.5 rounded-sm bg-primary shadow-[0_0_12px_3px_hsl(263_70%_60%/0.55)]"
      animate={{
        x: points.map((p) => p.x - 5),
        y: points.map((p) => p.y - 36),
        opacity: [0, 1, 1, 1, 1, 0],
      }}
      transition={{ duration: 7, times: [0, 0.05, 0.35, 0.65, 0.95, 1], repeat: Infinity, ease: "linear", repeatDelay: 1.2 }}
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
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, el.clientWidth / SCENE_W));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const activeCount = agents.filter((a) => a.status === "working").length;

  return (
    <div className="glass relative overflow-hidden rounded-3xl">
      {/* Status pill */}
      <div className="absolute right-4 top-4 z-[70] flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 backdrop-blur-md">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            activeCount > 0 ? "animate-pulse-glow bg-emerald-400" : "bg-zinc-600",
          )}
        />
        <span className="text-[11px] font-medium text-muted-foreground">
          {activeCount > 0 ? `${activeCount} agent${activeCount > 1 ? "s" : ""} working` : "Crew on standby"}
          {queueDepth > 0 ? ` · ${queueDepth} queued` : ""}
        </span>
      </div>

      <div ref={wrapRef} className="relative w-full" style={{ height: SCENE_H * scale }}>
        <div
          className="absolute left-1/2 top-0 origin-top"
          style={{ width: SCENE_W, height: SCENE_H, transform: `translateX(-50%) scale(${scale})` }}
        >
          <Scenery />

          {/* Station label chips */}
          {STATIONS.map((s) => {
            const p = iso(s.at[0], s.at[1]);
            const agentWorking = agents.find((a) => a.key === s.key)?.status === "working";
            return (
              <div
                key={s.key}
                className="absolute z-50 -translate-x-1/2"
                style={{ left: p.x, top: p.y - 66 }}
              >
                <div
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-lg border bg-background/70 px-2 py-1 shadow-lg backdrop-blur-md transition-colors duration-300",
                    agentWorking ? "border-primary/50" : "border-border/60",
                  )}
                >
                  <span className="text-[11px]">{s.emoji}</span>
                  <span className="text-[10px] font-semibold tracking-wide text-foreground/90">
                    {s.label}
                  </span>
                  {agentWorking && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 text-[9px] font-semibold text-emerald-300">
                      Active
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Ambient props */}
          <div className="absolute z-40 -translate-x-1/2 text-lg" style={{ left: iso(0.9, 8.6).x, top: iso(0.9, 8.6).y - 20 }}>🪴</div>
          <div className="absolute z-40 -translate-x-1/2 text-lg" style={{ left: iso(8.9, 0.8).x, top: iso(8.9, 0.8).y - 20 }}>🪴</div>
          <div className="absolute z-40 -translate-x-1/2 text-sm" style={{ left: iso(3.4, 8.2).x, top: iso(3.4, 8.2).y - 16 }}>☕</div>

          {!reduced && <JobPacket active={activeCount > 0} />}

          {agents.map((agent, i) => (
            <Robot key={agent.key} agent={agent} entryDelay={i * 0.06} reduced={reduced} />
          ))}
        </div>
      </div>
    </div>
  );
}
