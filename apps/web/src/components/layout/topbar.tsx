"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Command, Search, Zap } from "lucide-react";
import { usePathname } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { HealthReport, NotificationT } from "@fable/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/studio": "Studio Floor",
  "/channels": "Channels",
  "/projects": "AI Projects",
  "/uploads": "Uploads",
  "/schedule": "Schedule",
  "/analytics": "Analytics",
  "/assets": "Assets",
  "/templates": "Templates",
  "/settings": "Settings",
  "/billing": "Billing",
};

export function Topbar() {
  const pathname = usePathname();
  const qc = useQueryClient();
  // Anchored the way the sidebar matches: a bare startsWith would let a future
  // /clippings (or /settings-v2) borrow this section's title.
  const section = Object.keys(TITLES).find(
    (k) => pathname === k || pathname.startsWith(`${k}/`),
  );

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<HealthReport>("/health"),
    refetchInterval: 30_000,
  });

  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<NotificationT[]>("/notifications"),
    refetchInterval: 20_000,
  });

  const markAll = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <h1 className="font-display text-lg font-semibold tracking-tight">
        {section ? TITLES[section] : "Fable Studio"}
      </h1>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => document.dispatchEvent(new CustomEvent("fable:open-command"))}
          className="hidden items-center gap-2 rounded-xl border border-border/70 bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground md:flex"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search or jump to…</span>
          <kbd className="ml-4 flex items-center gap-0.5 rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-medium">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </button>

        {health && (
          <div
            className={cn(
              "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:flex",
              health.aiProvider === "mock"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
            )}
            title={`AI: ${health.aiProvider} · queue: ${health.queueDriver} · ffmpeg: ${health.ffmpeg ? "yes" : "no"}`}
          >
            <Zap className="h-3 w-3" />
            {health.aiProvider === "mock" ? "Demo AI" : health.aiProvider}
          </div>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="relative rounded-xl border border-border/70 bg-secondary/40 p-2 transition-colors hover:border-primary/40">
              <Bell className="h-4 w-4 text-muted-foreground" />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                  {unread}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-96 p-0">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <span className="text-sm font-semibold">Notifications</span>
              {unread > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => markAll.mutate()}
                >
                  <Check className="h-3 w-3" /> Mark all read
                </Button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {(notifications ?? []).length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nothing yet — renders and uploads will report here.
                </p>
              )}
              {(notifications ?? []).slice(0, 20).map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "border-b border-border/40 px-4 py-3 last:border-0",
                    !n.read && "bg-primary/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-tight">{n.title}</p>
                    {!n.read && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                  </div>
                  {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
                  <p className="mt-1 text-[10px] text-muted-foreground/60">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="gradient-primary flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white">
          DF
        </div>
      </div>
    </header>
  );
}
