"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import type { ChannelType } from "@fable/shared";
import { CHANNEL_TYPES, slugify } from "@fable/shared";
import { api, ApiError } from "@/lib/api";
import { CHANNEL_TYPE_META, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { avatarGradient } from "./channel-card";

const AVATAR_COLORS = ["#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#6366f1", "#3b82f6"];

const STEP_TITLES = ["Pick a format", "Name your channel", "Choose a look"];

export function NewChannelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  // The format picker is step 0. It was skipped back when the studio was only
  // Would-You-Rather, but Campaign Clipping is now its own live section and it
  // selects channels by `type !== "wyr"` — so with the picker skipped there was
  // no way to create a channel that section could see, and no way to change a
  // channel's type afterwards either (PATCH /channels does not accept it).
  const [step, setStep] = useState(0);
  const [type, setType] = useState<ChannelType | null>(null);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [handleTouched, setHandleTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);

  // Fresh wizard every time it opens.
  useEffect(() => {
    if (open) {
      setStep(0);
      setType(null);
      setName("");
      setHandle("");
      setHandleTouched(false);
      setDescription("");
      setAvatarColor(AVATAR_COLORS[0]);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const channel = await api.post<{ id: string }>("/channels", {
        name: name.trim(),
        handle: cleanHandle(handle),
        type,
        description: description.trim() || undefined,
      });
      await api.patch(`/channels/${channel.id}`, { avatarColor });
      return channel;
    },
    onSuccess: () => {
      toast.success("Channel created");
      qc.invalidateQueries({ queryKey: ["channels"] });
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not create channel"),
  });

  const canContinue =
    step === 0 ? type !== null : step === 1 ? name.trim().length > 0 && cleanHandle(handle).length > 0 : true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            New channel
          </DialogTitle>
          <DialogDescription>
            Step {step + 1} of 3 — {STEP_TITLES[step]}
          </DialogDescription>
        </DialogHeader>

        <div className="mb-1 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= step ? "gradient-primary" : "bg-secondary",
              )}
            />
          ))}
        </div>

        <motion.div
          key={step}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
        >
          {step === 0 && (
            <div className="space-y-2.5">
              {CHANNEL_TYPES.map((t) => {
                const meta = CHANNEL_TYPE_META[t.value];
                const selected = type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    className={cn(
                      "flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-[color,background-color,border-color,box-shadow]",
                      selected
                        ? "border-primary/60 bg-primary/10 shadow-[0_0_20px_rgba(139,92,246,0.15)]"
                        : "border-border/70 bg-secondary/30 hover:border-primary/30 hover:bg-secondary/50",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-2xl",
                        meta?.gradient ?? "from-violet-500 to-fuchsia-500",
                      )}
                    >
                      <span aria-hidden>{meta?.emoji ?? "🎬"}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{t.label}</p>
                      <p className="text-xs text-muted-foreground">{t.tagline}</p>
                    </div>
                    <div
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                        selected ? "border-primary bg-primary" : "border-border",
                      )}
                    >
                      {selected && <Check className="h-3 w-3 text-white" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="channel-name">Channel name</Label>
                <Input
                  id="channel-name"
                  autoFocus
                  placeholder="Brain Battles"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!handleTouched) setHandle(slugify(e.target.value));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="channel-handle">Handle</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                    @
                  </span>
                  <Input
                    id="channel-handle"
                    className="pl-8"
                    placeholder="brainbattles"
                    value={handle}
                    onChange={(e) => {
                      setHandleTouched(true);
                      setHandle(e.target.value);
                    }}
                    onBlur={() => setHandle(cleanHandle(handle))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="channel-description">Description (optional)</Label>
                <Textarea
                  id="channel-description"
                  rows={3}
                  placeholder="Daily would-you-rather questions that break brains…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="flex flex-col items-center gap-4 py-2">
                <div
                  className="flex h-20 w-20 items-center justify-center rounded-3xl text-3xl font-bold text-white shadow-xl glow-primary"
                  style={{ backgroundImage: avatarGradient(avatarColor) }}
                >
                  {(name.trim().charAt(0) || "F").toUpperCase()}
                </div>
                <div className="text-center">
                  <p className="font-semibold">{name.trim() || "Your channel"}</p>
                  <p className="text-sm text-muted-foreground">@{cleanHandle(handle) || "handle"}</p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Avatar colour</Label>
                <div className="flex flex-wrap gap-2.5">
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Avatar colour ${c}`}
                      onClick={() => setAvatarColor(c)}
                      className={cn(
                        "h-9 w-9 rounded-full border-2 transition-transform duration-150 ease-[var(--ease-out)] hover:scale-110",
                        avatarColor === c
                          ? "border-white shadow-[0_0_0_3px_rgba(139,92,246,0.45)]"
                          : "border-transparent",
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </motion.div>

        <div className="mt-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className={cn("gap-1.5", step === 0 && "invisible")}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={create.isPending}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          {step < 2 ? (
            <Button size="sm" className="gap-1.5" disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
              Continue <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={create.isPending || !canContinue}
              onClick={() => create.mutate()}
            >
              {create.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Create channel
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function cleanHandle(raw: string): string {
  return raw
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 30);
}
