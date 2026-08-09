"use client";

/**
 * Mode chooser — which of the two businesses you are running right now.
 *
 * Deliberately OUTSIDE the (app) route group: that layout wraps everything in
 * the Sidebar/Topbar built around the Would-You-Rather flow, and a chooser
 * wearing one side's chrome has already made the choice for you.
 *
 * The two modes are genuinely different work, not two views of one thing.
 * Would You Rather generates videos from nothing on channels you own, on
 * autopilot. Campaign Clipping cuts someone else's footage to a paid brief
 * that dictates the caption and the on-screen text, and pays per view. They
 * share an account and almost nothing else.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Scissors, Sparkles } from "lucide-react";
import { ENTER, EASE_OUT, staggerDelay } from "@/lib/motion";
import { CHANNEL_TYPE_META } from "@/lib/utils";

const MODES = [
  {
    href: "/dashboard",
    // Same emoji and gradient the rest of the app already uses for these
    // channel types, so the chooser is recognisably the same product.
    emoji: CHANNEL_TYPE_META.wyr.emoji,
    gradient: CHANNEL_TYPE_META.wyr.gradient,
    title: "Would You Rather",
    blurb: "Generate and schedule original Shorts on your own channels, on autopilot.",
    points: ["Your channels", "Fully automated", "Ad + channel revenue"],
    Icon: Sparkles,
  },
  {
    href: "/clipping",
    emoji: CHANNEL_TYPE_META.clips.emoji,
    gradient: CHANNEL_TYPE_META.clips.gradient,
    title: "Campaign Clipping",
    blurb: "Cut clips for paid briefs. The brief supplies the caption and the approved on-screen text.",
    points: ["Someone else's footage", "Paid per 1k views", "Rules you must follow"],
    Icon: Scissors,
  },
] as const;

export default function ChoosePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={ENTER}
        className="mb-10 text-center"
      >
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          What are you working on?
        </h1>
        <p className="mt-3 text-sm text-zinc-400">
          Two different jobs. Pick one — you can switch whenever.
        </p>
      </motion.div>

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
        {MODES.map((mode, index) => (
          <motion.div
            key={mode.href}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...ENTER, delay: staggerDelay(index) }}
          >
            <Link
              href={mode.href}
              className="glass glass-hover group flex h-full flex-col items-start gap-4 rounded-2xl p-6 text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${mode.gradient} text-xl shadow-lg`}
                aria-hidden
              >
                {mode.emoji}
              </div>

              <div className="flex-1">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <mode.Icon className="h-4 w-4 text-zinc-400" aria-hidden />
                  {mode.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{mode.blurb}</p>
              </div>

              <ul className="flex flex-wrap gap-2">
                {mode.points.map((point) => (
                  <li
                    key={point}
                    className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300"
                  >
                    {point}
                  </li>
                ))}
              </ul>

              <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-violet-300">
                Open
                <motion.span
                  aria-hidden
                  className="inline-flex"
                  initial={false}
                  whileHover={{ x: 3 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                >
                  <ArrowRight className="h-4 w-4" />
                </motion.span>
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </main>
  );
}
