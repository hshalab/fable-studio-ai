"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  CalendarClock,
  CreditCard,
  FolderOpen,
  LayoutDashboard,
  LayoutTemplate,
  Plus,
  Scissors,
  Settings,
  Shuffle,
  Sparkles,
  Tv,
  UploadCloud,
} from "lucide-react";
import { Command } from "cmdk";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const PAGES = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Campaign Clipping", href: "/clipping", icon: Scissors },
  { label: "Switch mode", href: "/choose", icon: Shuffle },
  { label: "Channels", href: "/channels", icon: Tv },
  { label: "AI Projects", href: "/projects", icon: Sparkles },
  { label: "Uploads", href: "/uploads", icon: UploadCloud },
  { label: "Schedule", href: "/schedule", icon: CalendarClock },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Assets", href: "/assets", icon: FolderOpen },
  { label: "Templates", href: "/templates", icon: LayoutTemplate },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Billing", href: "/billing", icon: CreditCard },
];

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      // g then a letter — quick nav (Linear style)
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fable:open-command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fable:open-command", onOpen);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Keyboard-toggled 100+ times/day — no animation, ever (Raycast rule). */}
      <DialogContent animation="none" className="overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command className="bg-transparent" loop>
          <Command.Input
            placeholder="Type a command or search…"
            className="w-full border-b border-border/60 bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
              No results.
            </Command.Empty>
            <Command.Group
              heading="Create"
              className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              <Item onSelect={() => go("/projects/new")}>
                <Plus className="h-4 w-4 text-primary" /> New AI project
              </Item>
              <Item onSelect={() => go("/channels?new=1")}>
                <Plus className="h-4 w-4 text-primary" /> New channel
              </Item>
            </Command.Group>
            <Command.Group
              heading="Go to"
              className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {PAGES.map((p) => (
                <Item key={p.href} onSelect={() => go(p.href)}>
                  <p.icon className="h-4 w-4 text-muted-foreground" /> {p.label}
                </Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Item({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground aria-selected:bg-primary/15 aria-selected:text-foreground"
    >
      {children}
    </Command.Item>
  );
}
