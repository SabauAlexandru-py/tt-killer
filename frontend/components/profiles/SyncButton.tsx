"use client";

/**
 * SyncButton — "Sync from proxies" action for the Profiles page.
 *
 * Calls `POST /api/profiles/sync` via `api.syncProfiles` and, on success,
 * invalidates both the profiles list and the proxies list (the backend
 * creates one AdsPower profile per stored proxy that doesn't have one,
 * which can shift state on both sides).
 *
 * The button owns its own mutation so the page just drops it in:
 *
 *   <SyncButton />
 *
 * — no wiring required. Toasts via sonner. Pulls the button chrome from
 * the shared <Button /> primitive so hover / focus-visible / disabled
 * states match the rest of Mission Control.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { toast } from "sonner";

import { syncProfiles } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { SyncProfilesResult } from "@/lib/types";
import Button from "@/components/ui/Button";

export interface SyncButtonProps {
  /** Optional callback fired after a successful sync. */
  onSynced?: (result: SyncProfilesResult) => void;
  /** Size pass-through — default matches other TopBar actions. */
  size?: "sm" | "default" | "lg";
  /** Visual variant — defaults to "default"; use "primary" when it's the hero CTA. */
  variant?: "default" | "primary" | "ghost";
  /** Override the label (defaults to "Sync from proxies"). */
  label?: string;
}

export function SyncButton({
  onSynced,
  size = "default",
  variant = "default",
  label = "Sync from proxies",
}: SyncButtonProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation<SyncProfilesResult, Error, void>({
    mutationKey: ["profiles", "sync"],
    mutationFn: () => syncProfiles(),
    onSuccess: (result) => {
      const createdCount = result.created.length;
      const skippedCount = result.skipped.length;

      // Per-case toast: distinguish "we actually did something" from
      // "nothing to do, your profiles already match your proxies".
      if (createdCount > 0) {
        toast.success(
          createdCount === 1
            ? "Created 1 profile"
            : `Created ${createdCount} profiles`,
          {
            description:
              skippedCount > 0
                ? `${skippedCount} proxies already had a profile.`
                : undefined,
          },
        );
      } else {
        toast.message("Profiles already in sync", {
          description:
            skippedCount > 0
              ? `${skippedCount} proxies already have a profile.`
              : "No stored proxies to sync.",
        });
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies.all });

      onSynced?.(result);
    },
    onError: (err) => {
      toast.error("Sync failed", {
        description: err?.message ?? "Unexpected error talking to AdsPower.",
      });
    },
  });

  return (
    <Button
      size={size}
      variant={variant}
      loading={mutation.isPending}
      icon={
        mutation.isPending ? undefined : (
          <RotateCw size={14} strokeWidth={1.75} aria-hidden />
        )
      }
      onClick={() => mutation.mutate()}
      aria-label={label}
      title="Create one AdsPower profile per stored proxy that doesn't have one yet"
    >
      {mutation.isPending ? "Syncing…" : label}
    </Button>
  );
}

export default SyncButton;
