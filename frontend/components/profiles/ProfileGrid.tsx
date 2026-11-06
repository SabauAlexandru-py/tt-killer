"use client";

/**
 * ProfileGrid — AdsPower-style card grid for `/profiles`.
 *
 * Task spec (DESIGN_BRIEF_V2 §4, re-scoped by the panel task):
 *   - CSS grid, `repeat(auto-fill, minmax(220px, 1fr))`, 16px gap.
 *   - Each ProfileCard:
 *       header → StatusLED + name + mono user_id (truncated 10ch…6ch) + ⋮
 *       middle → ScreenshotThumb 120×200 phone aspect, hover-expands to
 *                a floating 360×600 preview, Skeleton shimmer while loading
 *       footer → proxy Pill tone="info", rotation LED (steady < 15m,
 *                slow-pulse otherwise), ⋮ menu → Inspector / Open / Close /
 *                Delete
 *   - Card hover: scale(1.01), border → --accent-border, glow box-shadow
 *   - Selected (click/shift-click): accent border + checkmark badge TR
 *   - Bulk action bar slides up when selection > 0 (Warm up / Delete)
 *   - Mobile responsive: single column < 640px
 *
 * The component intentionally stays self-contained — no new files for the
 * card, thumb, or menu — so the review target is one artifact + the page
 * wiring. Internal helpers are hoisted below the exported grid.
 *
 * All colors come from CSS variables (DESIGN_SPEC tokens). Every animation
 * uses --dur-* and --ease-* so the brief's motion vocabulary stays single-
 * sourced.
 */

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  Check,
  Flame,
  MoreVertical,
  Play,
  Smartphone,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  buildApiUrl,
  closeProfile,
  deleteProfile,
  openProfile,
  warmupAccountsRun,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/cn";
import type { AdsPowerProfile, StoredProxy } from "@/lib/types";
import { useInspectorState } from "@/lib/ui-store";
import { Led, type LedPattern, type LedTone } from "@/components/ui/LED";
import Pill from "@/components/ui/Pill";
import Button from "@/components/ui/Button";

import { ProfileInspector } from "./ProfileInspector";
import {
  deriveProfileStatus,
  formatProxyEndpoint,
  parseAdsPowerTime,
} from "./profile-format";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export interface ProfileGridProps {
  profiles: AdsPowerProfile[];
  /**
   * Stored proxies keyed by host:port. Used to compute the rotation LED
   * freshness per card. Optional — missing proxies default to `info` steady.
   */
  proxies?: StoredProxy[];
  loading?: boolean;
  /** Empty-state shown when profiles.length === 0 && !loading. */
  empty?: ReactNode;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type ProfileLedTone = Exclude<LedTone, "rainbow">;

interface ResolvedProfileStatus {
  tone: ProfileLedTone;
  pattern: LedPattern;
  label: string;
}

interface RotationFreshness {
  tone: ProfileLedTone;
  pattern: LedPattern;
  label: string;
  isFresh: boolean;
}

// Rotation thresholds — task spec says <15m = fresh.
const ROTATION_FRESH_MS = 15 * 60 * 1000;
const ROTATION_STALE_MS = 60 * 60 * 1000;

// Mobile breakpoint for single-column collapse.
const MOBILE_BREAKPOINT = 640;

// ---------------------------------------------------------------------------
// ProfileGrid (exported)
// ---------------------------------------------------------------------------

export function ProfileGrid({
  profiles,
  proxies,
  loading,
  empty,
}: ProfileGridProps) {
  const { openInspector, inspector, closeInspector } = useInspectorState();
  const queryClient = useQueryClient();

  // Map host:port → stored proxy so rotation freshness is O(1) per card.
  const proxyByEndpoint = useMemo(() => {
    const map = new Map<string, StoredProxy>();
    if (!proxies) return map;
    for (const p of proxies) {
      map.set(`${p.host}:${p.port}`, p);
    }
    return map;
  }, [proxies]);

  // --- Selection state (keyed on user_id) -----------------------------------
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [lastAnchor, setLastAnchor] = useState<string | null>(null);

  // Prune selection whenever the profile set shrinks so stale ids don't
  // leak into the action bar.
  useEffect(() => {
    if (selected.size === 0) return;
    const live = new Set(profiles.map((p) => p.user_id));
    let changed = false;
    const next = new Set<string>();
    for (const id of selected) {
      if (live.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelected(next);
  }, [profiles, selected]);

  const inspectorId = inspector?.id ?? null;

  const invalidateProfiles = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
  }, [queryClient]);

  // --- Mutations used by card menu + bulk bar -------------------------------
  const openMutation = useMutation({
    mutationKey: ["profiles", "open"],
    mutationFn: (userId: string) => openProfile(userId),
    onSuccess: (_d, userId) => {
      toast.success("Browser launched", { description: userId });
      invalidateProfiles();
    },
    onError: (err: Error) =>
      toast.error("Could not launch browser", {
        description: err.message ?? "AdsPower refused the request.",
      }),
  });

  const closeMutation = useMutation({
    mutationKey: ["profiles", "close"],
    mutationFn: (userId: string) => closeProfile(userId),
    onSuccess: (_d, userId) => {
      toast.message("Browser closed", { description: userId });
      invalidateProfiles();
    },
    onError: (err: Error) =>
      toast.error("Could not close browser", {
        description: err.message ?? "AdsPower refused the request.",
      }),
  });

  const deleteMutation = useMutation({
    mutationKey: ["profiles", "delete"],
    mutationFn: (userId: string) => deleteProfile(userId),
    onSuccess: (_d, userId) => {
      toast.success("Profile deleted", { description: userId });
      invalidateProfiles();
    },
    onError: (err: Error) =>
      toast.error("Delete failed", {
        description: err.message ?? "AdsPower refused the delete.",
      }),
  });

  // Bulk warmup — single orchestrator call with the selected profile_ids.
  const warmupMutation = useMutation({
    mutationKey: ["runs", "warmup"],
    mutationFn: (profileIds: string[]) =>
      warmupAccountsRun({ profile_ids: profileIds }),
    onSuccess: (res) => {
      toast.success("Warmup queued", {
        description: `Run ${res.run_id} started.`,
      });
      invalidateProfiles();
      setSelected(new Set());
    },
    onError: (err: Error) =>
      toast.error("Warmup failed to start", {
        description: err.message ?? "Backend rejected the run.",
      }),
  });

  // Bulk delete is a serial fan-out — the backend doesn't expose /profiles/bulk.
  const bulkDeleteMutation = useMutation({
    mutationKey: ["profiles", "delete-bulk"],
    mutationFn: async (profileIds: string[]) => {
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];
      for (const id of profileIds) {
        try {
          await deleteProfile(id);
          results.push({ id, ok: true });
        } catch (e) {
          results.push({
            id,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      if (fail === 0) {
        toast.success("Profiles deleted", {
          description: `${ok} profile${ok === 1 ? "" : "s"} removed.`,
        });
      } else {
        toast.error(`Deleted ${ok}, ${fail} failed`, {
          description: "Check the AdsPower bridge and retry.",
        });
      }
      invalidateProfiles();
      setSelected(new Set());
    },
    onError: (err: Error) =>
      toast.error("Bulk delete failed", {
        description: err.message ?? "Nothing was removed.",
      }),
  });

  // --- Selection handlers ---------------------------------------------------
  const toggleOne = useCallback((userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  const handleCardClick = useCallback(
    (profile: AdsPowerProfile, event: ReactMouseEvent) => {
      const userId = profile.user_id;

      // Shift-click → range select from anchor to this card in reading order.
      if (event.shiftKey && lastAnchor) {
        event.preventDefault();
        const ids = profiles.map((p) => p.user_id);
        const a = ids.indexOf(lastAnchor);
        const b = ids.indexOf(userId);
        if (a === -1 || b === -1) {
          toggleOne(userId);
          setLastAnchor(userId);
          return;
        }
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setSelected((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) {
            const id = ids[i];
            if (id) next.add(id);
          }
          return next;
        });
        setLastAnchor(userId);
        return;
      }

      // Cmd/Ctrl-click → toggle a single card without opening the inspector.
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        toggleOne(userId);
        setLastAnchor(userId);
        return;
      }

      // Plain click: open or toggle inspector.
      const id = `profile:${userId}`;
      if (id === inspectorId) {
        closeInspector();
      } else {
        openInspector({
          id,
          title: profile.name ?? userId,
          body: <ProfileInspector profile={profile} />,
        });
      }
      setLastAnchor(userId);
    },
    [closeInspector, inspectorId, lastAnchor, openInspector, profiles, toggleOne],
  );

  // Esc clears selection globally so the sticky bar is always escapable.
  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  // --- Rendering ------------------------------------------------------------
  const isEmpty = !loading && profiles.length === 0;

  if (loading) {
    return (
      <div style={gridContainerStyle} aria-busy="true" aria-live="polite">
        <style jsx>{SHARED_STYLES}</style>
        <div className="profile-grid" role="list">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div style={gridContainerStyle}>
        <style jsx>{SHARED_STYLES}</style>
        <div style={{ gridColumn: "1 / -1" }}>{empty}</div>
      </div>
    );
  }

  return (
    <div style={gridContainerStyle}>
      <style jsx>{SHARED_STYLES}</style>
      <div
        className="profile-grid"
        role="list"
        aria-label={`AdsPower profiles — ${profiles.length} total, ${selected.size} selected`}
      >
        {profiles.map((profile) => {
          const endpoint = formatProxyEndpoint(profile.user_proxy_config);
          const proxyRecord = endpoint ? proxyByEndpoint.get(endpoint) : null;
          return (
            <ProfileCard
              key={profile.user_id}
              profile={profile}
              proxy={proxyRecord ?? null}
              isSelected={selected.has(profile.user_id)}
              isInspectorOpen={inspectorId === `profile:${profile.user_id}`}
              onClick={handleCardClick}
              onToggleSelect={(e) => {
                e.stopPropagation();
                toggleOne(profile.user_id);
                setLastAnchor(profile.user_id);
              }}
              onMenuOpenInspector={() =>
                openInspector({
                  id: `profile:${profile.user_id}`,
                  title: profile.name ?? profile.user_id,
                  body: <ProfileInspector profile={profile} />,
                })
              }
              openMutation={openMutation}
              closeMutation={closeMutation}
              deleteMutation={deleteMutation}
            />
          );
        })}
      </div>

      <BulkActionBar
        count={selected.size}
        total={profiles.length}
        onClear={() => setSelected(new Set())}
        onWarmup={() => warmupMutation.mutate(Array.from(selected))}
        onDelete={() => {
          const ids = Array.from(selected);
          const confirmed =
            typeof window === "undefined"
              ? true
              : window.confirm(
                  `Delete ${ids.length} AdsPower profile${
                    ids.length === 1 ? "" : "s"
                  }? This cannot be undone.`,
                );
          if (confirmed) bulkDeleteMutation.mutate(ids);
        }}
        warmupBusy={warmupMutation.isPending}
        deleteBusy={bulkDeleteMutation.isPending}
      />
    </div>
  );
}

export default ProfileGrid;

// ---------------------------------------------------------------------------
// ProfileCard
// ---------------------------------------------------------------------------

interface ProfileCardProps {
  profile: AdsPowerProfile;
  proxy: StoredProxy | null;
  isSelected: boolean;
  isInspectorOpen: boolean;
  onClick: (profile: AdsPowerProfile, event: ReactMouseEvent) => void;
  onToggleSelect: (event: ReactMouseEvent) => void;
  onMenuOpenInspector: () => void;
  openMutation: UseMutationResult<unknown, Error, string, unknown>;
  closeMutation: UseMutationResult<unknown, Error, string, unknown>;
  deleteMutation: UseMutationResult<unknown, Error, string, unknown>;
}

const ProfileCard = memo(function ProfileCard({
  profile,
  proxy,
  isSelected,
  isInspectorOpen,
  onClick,
  onToggleSelect,
  onMenuOpenInspector,
  openMutation,
  closeMutation,
  deleteMutation,
}: ProfileCardProps) {
  const status = resolveStatusLed(profile);
  const rotation = resolveRotation(proxy);
  const endpoint = formatProxyEndpoint(profile.user_proxy_config);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the menu on outside click / Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const onCardKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick(profile, e as unknown as ReactMouseEvent);
    }
  };

  // State flags for the LED pulse synced to any in-flight mutation on this
  // specific card (open/close/delete all take 1-5s with AdsPower).
  const busyOpen =
    openMutation.isPending && openMutation.variables === profile.user_id;
  const busyClose =
    closeMutation.isPending && closeMutation.variables === profile.user_id;
  const busyDelete =
    deleteMutation.isPending && deleteMutation.variables === profile.user_id;
  const cardBusy = busyOpen || busyClose || busyDelete;

  // Surface the mutation state on the status LED — busy = violet pulse.
  const ledTone: ProfileLedTone = cardBusy ? "busy" : status.tone;
  const ledPattern: LedPattern = cardBusy ? "pulse" : status.pattern;

  return (
    <article
      role="listitem"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${profile.name ?? profile.user_id}, ${status.label}`}
      className={cn(
        "profile-card",
        isSelected && "is-selected",
        isInspectorOpen && "is-open",
        cardBusy && "is-busy",
      )}
      onClick={(e) => onClick(profile, e)}
      onKeyDown={onCardKey}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "12px",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
        border: `1px solid ${
          isSelected ? "var(--accent-border)" : "var(--border)"
        }`,
        boxShadow: isSelected
          ? "0 0 0 1px var(--accent-border), 0 6px 20px oklch(0.72 0.17 160 / 0.14)"
          : "none",
        cursor: "pointer",
        transition:
          "transform var(--dur-normal) var(--ease-out), border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-normal) var(--ease-out), background var(--dur-fast) var(--ease-out)",
        overflow: "visible",
        outline: "none",
      }}
    >
      {/* --- Selected checkmark (top-right) ---------------------------------- */}
      {isSelected && (
        <span
          aria-hidden
          className="selected-badge"
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            width: "20px",
            height: "20px",
            borderRadius: "999px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--accent)",
            color: "oklch(0.145 0 0)",
            boxShadow:
              "0 0 0 2px var(--bg-surface), 0 0 10px oklch(0.72 0.17 160 / 0.45)",
            zIndex: 3,
          }}
        >
          <Check size={12} strokeWidth={3} aria-hidden />
        </span>
      )}

      {/* --- Header: LED + name + user_id + ⋮ --------------------------------- */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          minWidth: 0,
        }}
      >
        <Led
          // We skip <StatusLED> here: it resolves tone from a semantic
          // AccountStatus string, but the grid's "busy mutation in flight"
          // overlay needs to take over the lens without inventing a new
          // orchestrator status. Driving <Led> directly keeps both the
          // normal status and the mutation overlay on one primitive.
          tone={ledTone}
          pattern={ledPattern}
          size="md"
          label={`${status.label} status`}
        />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
          <span
            className="truncate"
            style={{
              color: "var(--text-primary)",
              fontSize: "14px",
              fontWeight: 600,
              lineHeight: 1.2,
            }}
          >
            {profile.name ?? "Unnamed"}
          </span>
          <span
            title={profile.user_id}
            style={{
              color: "var(--text-muted)",
              fontSize: "11px",
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.3,
            }}
          >
            {truncateMiddle(profile.user_id, 10, 6)}
          </span>
        </div>

        {/* Hover-only selection toggle sits under the ⋮ when selected, so
            operators always have a way to add this card to the selection
            without using keyboard modifiers. */}
        <button
          type="button"
          aria-label={isSelected ? "Deselect card" : "Select card"}
          onClick={onToggleSelect}
          className="select-toggle"
          style={{
            width: "22px",
            height: "22px",
            borderRadius: "999px",
            border: `1px solid ${
              isSelected ? "var(--accent-border)" : "var(--border-strong)"
            }`,
            background: isSelected ? "var(--accent)" : "transparent",
            color: isSelected ? "oklch(0.145 0 0)" : "var(--text-muted)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition:
              "opacity var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)",
          }}
        >
          {isSelected ? (
            <Check size={12} strokeWidth={3} aria-hidden />
          ) : (
            <span
              aria-hidden
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "999px",
                background: "transparent",
                border: "1px solid var(--text-muted)",
              }}
            />
          )}
        </button>

        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            aria-label="Profile actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((prev) => !prev);
            }}
            style={{
              width: "26px",
              height: "26px",
              borderRadius: "var(--radius-sm)",
              background: menuOpen ? "var(--bg-hover)" : "transparent",
              color: "var(--text-secondary)",
              border: `1px solid ${menuOpen ? "var(--border-strong)" : "transparent"}`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition:
                "background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)",
            }}
          >
            <MoreVertical size={14} strokeWidth={1.75} aria-hidden />
          </button>
          {menuOpen && (
            <CardMenu
              profile={profile}
              onClose={() => setMenuOpen(false)}
              onInspect={() => {
                setMenuOpen(false);
                onMenuOpenInspector();
              }}
              onOpen={() => {
                setMenuOpen(false);
                openMutation.mutate(profile.user_id);
              }}
              onCloseBrowser={() => {
                setMenuOpen(false);
                closeMutation.mutate(profile.user_id);
              }}
              onDelete={() => {
                setMenuOpen(false);
                const label = profile.name ?? profile.user_id;
                const confirmed =
                  typeof window === "undefined"
                    ? true
                    : window.confirm(`Delete AdsPower profile "${label}"?`);
                if (confirmed) deleteMutation.mutate(profile.user_id);
              }}
            />
          )}
        </div>
      </header>

      {/* --- Thumb -------------------------------------------------------- */}
      <ScreenshotThumb
        userId={profile.user_id}
        label={profile.name ?? profile.user_id}
      />

      {/* --- Footer: proxy chip + rotation LED ---------------------------- */}
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          minWidth: 0,
        }}
      >
        {endpoint ? (
          <Pill
            tone="info"
            className="truncate"
            title={endpoint}
            style={{ maxWidth: "100%", minWidth: 0 }}
          >
            <span
              className="truncate"
              style={{
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
                fontSize: "11px",
                maxWidth: "100%",
                display: "inline-block",
              }}
            >
              {endpoint}
            </span>
          </Pill>
        ) : (
          <Pill tone="muted">No proxy</Pill>
        )}
        <div
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
          title={rotation.label}
        >
          <Led
            tone={rotation.tone}
            pattern={rotation.pattern}
            size="sm"
            label={rotation.label}
          />
        </div>
      </footer>
    </article>
  );
});

// ---------------------------------------------------------------------------
// ScreenshotThumb
// ---------------------------------------------------------------------------

interface ScreenshotThumbProps {
  userId: string;
  label: string;
}

function ScreenshotThumb({ userId, label }: ScreenshotThumbProps) {
  // Thumbs land at `backend/data/thumbs/{user_id}.png` per DESIGN_BRIEF_V2
  // §10 "open questions". Until the capture pipeline ships real images,
  // we fail quietly to the phone glyph placeholder below.
  const src = useMemo(
    () => buildApiUrl(`/data/thumbs/${encodeURIComponent(userId)}.png`),
    [userId],
  );
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  const [hover, setHover] = useState(false);

  // Reset the state whenever the src changes (card recycled across virtualized
  // scroll in the future).
  useEffect(() => {
    setState("loading");
  }, [src]);

  return (
    <div
      className="thumb-wrap"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        position: "relative",
        width: "100%",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        className="thumb"
        style={{
          position: "relative",
          width: "120px",
          height: "200px",
          borderRadius: "14px",
          overflow: "hidden",
          background: "var(--bg-base)",
          border: "1px solid var(--border)",
          boxShadow: "inset 0 0 0 2px oklch(0 0 0 / 0.5)",
        }}
      >
        {state === "loading" && <ShimmerFill />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`${label} browser screenshot`}
          loading="lazy"
          decoding="async"
          onLoad={() => setState("ok")}
          onError={() => setState("missing")}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: state === "ok" ? 1 : 0,
            transition: "opacity var(--dur-normal) var(--ease-out), filter var(--dur-normal) var(--ease-out)",
            filter: hover && state === "ok" ? "saturate(1.08)" : "none",
          }}
        />
        {state === "missing" && <PlaceholderGlyph />}
      </div>

      {/* Floating hover preview — 360×600, anchored above the card so it
          always has room to breathe even at edges of the viewport. */}
      {hover && state === "ok" && (
        <div
          className="thumb-preview"
          aria-hidden
          style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            left: "50%",
            transform: "translateX(-50%)",
            width: "360px",
            height: "600px",
            borderRadius: "18px",
            overflow: "hidden",
            background: "var(--bg-base)",
            border: "1px solid var(--border-strong)",
            boxShadow:
              "0 24px 48px oklch(0 0 0 / 0.55), 0 0 0 1px oklch(0.72 0.17 160 / 0.20)",
            zIndex: 10,
            pointerEvents: "none",
            animation: "thumb-rise var(--dur-normal) var(--ease-out) both",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        </div>
      )}
    </div>
  );
}

function ShimmerFill() {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        background:
          "linear-gradient(90deg, var(--bg-base) 0%, var(--bg-raised) 50%, var(--bg-base) 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1400ms var(--ease-smooth) infinite",
      }}
    />
  );
}

function PlaceholderGlyph() {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        color: "var(--text-muted)",
      }}
    >
      <Smartphone size={40} strokeWidth={1.25} aria-hidden />
      <span
        style={{
          fontSize: "10px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        No capture
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CardMenu — hand-rolled anchored menu
// ---------------------------------------------------------------------------

interface CardMenuProps {
  profile: AdsPowerProfile;
  onClose: () => void;
  onInspect: () => void;
  onOpen: () => void;
  onCloseBrowser: () => void;
  onDelete: () => void;
}

function CardMenu({
  onInspect,
  onOpen,
  onCloseBrowser,
  onDelete,
}: CardMenuProps) {
  return (
    <div
      role="menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: "6px",
        minWidth: "180px",
        padding: "4px",
        borderRadius: "var(--radius)",
        background: "var(--bg-raised)",
        border: "1px solid var(--border-strong)",
        boxShadow: "0 12px 32px oklch(0 0 0 / 0.55)",
        zIndex: 20,
        animation: "menu-pop var(--dur-fast) var(--ease-out) both",
      }}
    >
      <MenuItem icon={<Smartphone size={13} strokeWidth={1.75} />} onClick={onInspect}>
        Open in Inspector
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Play size={13} strokeWidth={1.75} />} onClick={onOpen}>
        Open browser
      </MenuItem>
      <MenuItem icon={<Square size={13} strokeWidth={1.75} />} onClick={onCloseBrowser}>
        Close browser
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<Trash2 size={13} strokeWidth={1.75} />}
        onClick={onDelete}
        destructive
      >
        Delete profile
      </MenuItem>
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  destructive,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        height: "30px",
        padding: "0 10px",
        borderRadius: "var(--radius-sm)",
        background: "transparent",
        color: destructive ? "var(--error)" : "var(--text-primary)",
        fontSize: "12px",
        fontWeight: 500,
        lineHeight: 1,
        textAlign: "left",
        border: "none",
        cursor: "pointer",
        transition: "background var(--dur-fast) var(--ease-out)",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = destructive
          ? "var(--error-bg)"
          : "var(--bg-hover)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ display: "inline-flex", color: "currentcolor" }}>{icon}</span>
      <span>{children}</span>
    </button>
  );
}

function MenuSeparator() {
  return (
    <div
      aria-hidden
      style={{
        height: "1px",
        margin: "4px 2px",
        background: "var(--border)",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// SkeletonCard
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <div
      role="listitem"
      aria-hidden
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "12px",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          style={{
            width: "10px",
            height: "10px",
            borderRadius: "999px",
            background: "var(--bg-raised)",
          }}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
          <span className="skel-line" style={{ width: "70%", height: "10px" }} />
          <span className="skel-line" style={{ width: "40%", height: "8px" }} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <span
          className="skel-line"
          style={{ width: "120px", height: "200px", borderRadius: "14px" }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span className="skel-line" style={{ flex: 1, height: "18px", borderRadius: "999px" }} />
        <span
          className="skel-line"
          style={{ width: "10px", height: "10px", borderRadius: "999px" }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BulkActionBar — sticky bottom bar when selection > 0
// ---------------------------------------------------------------------------

interface BulkActionBarProps {
  count: number;
  total: number;
  onClear: () => void;
  onWarmup: () => void;
  onDelete: () => void;
  warmupBusy: boolean;
  deleteBusy: boolean;
}

function BulkActionBar({
  count,
  total,
  onClear,
  onWarmup,
  onDelete,
  warmupBusy,
  deleteBusy,
}: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      aria-live="polite"
      style={{
        position: "sticky",
        bottom: "12px",
        left: 0,
        right: 0,
        marginTop: "16px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 12px 10px 14px",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-raised)",
        border: "1px solid var(--accent-border)",
        boxShadow:
          "0 18px 32px oklch(0 0 0 / 0.5), 0 0 0 1px oklch(0.72 0.17 160 / 0.14)",
        zIndex: 5,
        animation: "bulk-rise var(--dur-normal) var(--ease-out) both",
      }}
    >
      <Led tone="running" pattern="pulse" size="md" label="Bulk selection active" />
      <span style={{ color: "var(--text-primary)", fontSize: "13px", fontWeight: 600 }}>
        {count} selected
      </span>
      <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
        of {total}
      </span>
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        <Button
          variant="default"
          size="sm"
          onClick={onClear}
          icon={<X size={13} strokeWidth={1.75} aria-hidden />}
        >
          Clear
        </Button>
        <Button
          variant="primary"
          size="sm"
          loading={warmupBusy}
          onClick={onWarmup}
          icon={<Flame size={13} strokeWidth={1.75} aria-hidden />}
        >
          Warm up selected
        </Button>
        <Button
          variant="danger"
          size="sm"
          loading={deleteBusy}
          onClick={onDelete}
          icon={<Trash2 size={13} strokeWidth={1.75} aria-hidden />}
        >
          Delete selected
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * "10 characters … 6 characters". Returns the original string when it is
 * already short enough. Lives here rather than profile-format.ts because the
 * table uses the full id while the grid card is width-constrained.
 */
function truncateMiddle(value: string, head: number, tail: number): string {
  if (!value) return "";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/**
 * Map the status derived by profile-format (which uses the table's TokenName
 * vocabulary) onto the Led vocabulary (tone + pattern).
 *
 * Keeps the grid and table in lock-step on what "Running" / "Idle" / "Ready"
 * / "No proxy" mean, while unlocking the richer LED patterns V2 adds.
 */
function resolveStatusLed(profile: AdsPowerProfile): ResolvedProfileStatus {
  const base = deriveProfileStatus(profile);
  if (base.label === "Running") {
    return { tone: "running", pattern: "pulse", label: "Running" };
  }
  if (base.label === "Ready") {
    return { tone: "success", pattern: "steady", label: "Ready" };
  }
  if (base.label === "Idle") {
    return { tone: "idle", pattern: "steady", label: "Idle" };
  }
  if (base.label === "No proxy") {
    return { tone: "warning", pattern: "slow-pulse", label: "No proxy" };
  }
  return { tone: "idle", pattern: "steady", label: base.label };
}

/**
 * Rotation freshness → LED mapping. Task spec: steady under 15 minutes,
 * slow-pulse otherwise. We extend the semantic in one place:
 *
 *   <15m  → success / steady    "Rotated 4m ago"
 *   15-60m → warning / slow-pulse "Rotation stale"
 *   >60m   → error / slow-pulse   "Rotation very stale"
 *   never  → pending / steady    "Never rotated"
 */
function resolveRotation(proxy: StoredProxy | null): RotationFreshness {
  if (!proxy) {
    return {
      tone: "info",
      pattern: "steady",
      label: "Proxy not managed locally",
      isFresh: false,
    };
  }
  if (!proxy.last_rotated_at) {
    return {
      tone: "pending",
      pattern: "steady",
      label: "Proxy never rotated",
      isFresh: false,
    };
  }
  const when = parseAdsPowerTime(proxy.last_rotated_at);
  if (!when) {
    return {
      tone: "pending",
      pattern: "steady",
      label: "Rotation timestamp unreadable",
      isFresh: false,
    };
  }
  const age = Date.now() - when.getTime();
  if (age < ROTATION_FRESH_MS) {
    return {
      tone: "success",
      pattern: "steady",
      label: `Rotated ${formatShortRelative(age)} ago`,
      isFresh: true,
    };
  }
  if (age < ROTATION_STALE_MS) {
    return {
      tone: "warning",
      pattern: "slow-pulse",
      label: `Rotation stale (${formatShortRelative(age)})`,
      isFresh: false,
    };
  }
  return {
    tone: "error",
    pattern: "slow-pulse",
    label: `Rotation very stale (${formatShortRelative(age)})`,
    isFresh: false,
  };
}

function formatShortRelative(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

// ---------------------------------------------------------------------------
// Static styles — hoisted so React only parses them once
// ---------------------------------------------------------------------------

const gridContainerStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: "0",
  // Reserve bottom space for the sticky bulk bar so cards never hide behind it.
  paddingBottom: "4px",
};

const SHARED_STYLES = `
  .profile-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
    width: 100%;
    container-type: inline-size;
  }

  @media (max-width: ${MOBILE_BREAKPOINT}px) {
    .profile-grid {
      grid-template-columns: 1fr;
      gap: 12px;
    }
  }

  .profile-card:hover {
    transform: scale(1.01);
    border-color: var(--accent-border);
    box-shadow:
      0 0 0 1px var(--accent-border),
      0 10px 28px oklch(0.72 0.17 160 / 0.20);
  }

  .profile-card:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: 2px;
  }

  .profile-card.is-selected:hover {
    box-shadow:
      0 0 0 1px var(--accent-border),
      0 10px 28px oklch(0.72 0.17 160 / 0.28);
  }

  .profile-card.is-open {
    border-color: var(--accent-border);
    background: linear-gradient(
      180deg,
      oklch(0.72 0.17 160 / 0.04) 0%,
      var(--bg-surface) 80%
    );
  }

  .profile-card.is-busy::before {
    content: "";
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(
      135deg,
      oklch(0.74 0.17 300 / 0.5),
      oklch(0.72 0.17 160 / 0.3),
      oklch(0.74 0.17 300 / 0.5)
    );
    background-size: 200% 200%;
    animation: busy-sweep 2400ms linear infinite;
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
            mask-composite: exclude;
    pointer-events: none;
    z-index: 0;
  }

  .profile-card .select-toggle {
    opacity: 0;
    transform: scale(0.9);
  }
  .profile-card:hover .select-toggle,
  .profile-card:focus-within .select-toggle,
  .profile-card.is-selected .select-toggle {
    opacity: 1;
    transform: scale(1);
  }

  .skel-line {
    display: inline-block;
    background: linear-gradient(90deg, var(--bg-raised) 0%, var(--bg-hover) 50%, var(--bg-raised) 100%);
    background-size: 200% 100%;
    border-radius: var(--radius-sm);
    animation: shimmer 1400ms var(--ease-smooth) infinite;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @keyframes thumb-rise {
    from { opacity: 0; transform: translate(-50%, 4px) scale(0.98); }
    to   { opacity: 1; transform: translate(-50%, 0) scale(1); }
  }

  @keyframes menu-pop {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes bulk-rise {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @keyframes busy-sweep {
    0%   { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .profile-card,
    .profile-card:hover {
      transform: none;
      transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
    }
    .profile-card.is-busy::before,
    .skel-line { animation: none; }
    .thumb-preview { animation: none !important; }
  }
`;

// Unused exports kept for symmetry — allow consumers to assemble custom
// grids without duplicating helpers.
export { truncateMiddle, resolveRotation, resolveStatusLed };
export { Fragment as _ProfileGridFragment };
