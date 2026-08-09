"use client";

/**
 * Header for the Campaign Clipping shell.
 *
 * Deliberately thinner than the main Topbar. That one carries pipeline health
 * and the notification feed, both of which are about generation jobs — none of
 * which exist on this side of the product, where the work happens in
 * clip-engine on the operator's machine and arrives here already rendered.
 * Showing an idle queue and an empty bell would be chrome pretending to be
 * information.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Scissors } from "lucide-react";

const TITLES: Record<string, string> = {
  "/clipping": "Overview",
  "/clipping/clips": "Clips",
  "/clipping/payouts": "Payouts",
  "/clipping/channels": "Channels",
};

export function ClipTopbar() {
  const pathname = usePathname();
  // Longest match first, so /clipping/clips does not resolve to "Overview".
  const section = Object.keys(TITLES)
    .sort((a, b) => b.length - a.length)
    .find((k) => pathname === k || pathname.startsWith(`${k}/`));

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      {/* The section badge doubles as the only visible nav below lg, where the
          sidebar is hidden. */}
      <Link
        href="/clipping"
        className="flex items-center gap-2 text-sm font-semibold lg:hidden"
      >
        <Scissors className="h-4 w-4 text-indigo-300" />
        Clipping
      </Link>
      <span className="text-sm text-muted-foreground lg:hidden">/</span>
      <h1 className="text-sm font-semibold">{section ? TITLES[section] : "Clipping"}</h1>
    </header>
  );
}
