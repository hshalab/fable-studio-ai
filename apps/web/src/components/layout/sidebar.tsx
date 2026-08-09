"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bot,
  CalendarClock,
  CreditCard,
  FolderOpen,
  LayoutDashboard,
  LayoutTemplate,
  Settings,
  Shuffle,
  Sparkles,
  Tv,
  UploadCloud,
  Wand2,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/studio", label: "Studio Floor", icon: Bot },
  { href: "/channels", label: "Channels", icon: Tv },
  { href: "/projects", label: "AI Projects", icon: Sparkles },
  { href: "/uploads", label: "Uploads", icon: UploadCloud },
  { href: "/schedule", label: "Schedule", icon: CalendarClock },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/assets", label: "Assets", icon: FolderOpen },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/billing", label: "Billing", icon: CreditCard },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border/60 bg-background/70 backdrop-blur-xl lg:flex">
      <Link href="/dashboard" className="flex items-center gap-3 px-6 pb-2 pt-6">
        <div className="gradient-primary flex h-9 w-9 items-center justify-center rounded-xl glow-primary">
          <Wand2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <div className="font-display text-lg font-bold leading-none tracking-tight">
            Fable Studio
          </div>
          <div className="gradient-text text-[11px] font-semibold tracking-widest">AI</div>
        </div>
      </Link>

      <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-3">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl border border-primary/25 bg-primary/15"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <item.icon
                className={cn(
                  "relative h-[18px] w-[18px]",
                  active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                )}
              />
              <span className="relative">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border/60 p-4">
        {/* Way back to the chooser. Without it the only route to the other
            mode is editing the URL, since /choose has no chrome of its own. */}
        <Link
          href="/choose"
          className="mb-3 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <Shuffle className="h-[18px] w-[18px]" />
          <span>Switch mode</span>
        </Link>
        <div className="glass rounded-xl p-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs font-medium text-muted-foreground">Automation active</span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground/70">
            Press <kbd className="rounded bg-secondary px-1 py-0.5 text-[10px]">⌘K</kbd> for the
            command palette
          </p>
        </div>
      </div>
    </aside>
  );
}
