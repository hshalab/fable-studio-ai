"use client";

/**
 * Navigation for the Campaign Clipping section.
 *
 * A separate component from the main Sidebar rather than a prop on it: the two
 * shells share a silhouette and nothing else. This one's sections are the
 * clipping workflow — what got cut, what is eligible to claim — where the
 * main sidebar's are the generation pipeline. Folding both into one component
 * with a mode flag would mean every future change to either has to reason
 * about the other.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { BadgePoundSterling, Film, LayoutGrid, Scissors, Shuffle, Tv } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/clipping", label: "Overview", icon: LayoutGrid },
  { href: "/clipping/clips", label: "Clips", icon: Film },
  { href: "/clipping/payouts", label: "Payouts", icon: BadgePoundSterling },
  { href: "/clipping/channels", label: "Channels", icon: Tv },
] as const;

export function ClipSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border/60 bg-background/70 backdrop-blur-xl lg:flex">
      <Link href="/clipping" className="flex items-center gap-3 px-6 pb-2 pt-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-indigo-500 shadow-lg shadow-indigo-500/20">
          <Scissors className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="font-display text-lg font-bold leading-none tracking-tight">
            Campaign
          </div>
          <div className="bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-[11px] font-semibold tracking-widest text-transparent">
            CLIPPING
          </div>
        </div>
      </Link>

      <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3">
        {NAV.map((item) => {
          // Exact match for the section root, prefix match for its children —
          // otherwise "Overview" stays lit on every page beneath it.
          const active =
            item.href === "/clipping"
              ? pathname === "/clipping"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              {active && (
                <motion.div
                  // Distinct from the main sidebar's "sidebar-active". The two
                  // shells never mount together, but a shared layoutId across
                  // route groups is the kind of thing that only breaks once
                  // something else changes.
                  layoutId="clip-sidebar-active"
                  className="absolute inset-0 rounded-xl border border-indigo-400/25 bg-indigo-400/15"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <item.icon
                className={cn(
                  "relative h-[18px] w-[18px]",
                  active ? "text-indigo-300" : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              <span className="relative">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border/60 p-4">
        <Link
          href="/choose"
          className="mb-3 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <Shuffle className="h-[18px] w-[18px]" />
          <span>Switch mode</span>
        </Link>
        <div className="glass rounded-xl p-3">
          <p className="text-[11px] leading-snug text-muted-foreground/70">
            Briefs set the caption and the approved on-screen text. clip-engine
            renders to them — this is where the output lands.
          </p>
        </div>
      </div>
    </aside>
  );
}
