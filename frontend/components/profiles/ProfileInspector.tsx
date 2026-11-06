"use client";

/**
 * ProfileInspector — body rendered into the right Inspector pane when an
 * AdsPower profile row (or grid card) is clicked.
 *
 * Layout (top → bottom):
 *   1. Action bar: Open browser (primary) / Close / Delete.
 *   2. Live Status panel: 3 LEDs — proxy health · AdsPower bridge · browser.
 *   3. Status pill (derived from profile.user_proxy_config / active extras).
 *   4. Summary grid: name, user_id, serial, group, created.
 *   5. Network block: IP, country, proxy host/port/type/user/password toggle.
 *   6. Raw JSON: every field we didn't display explicitly, pre-rendered.
 *
 * DESIGN_BRIEF_V2 adds:
 *   - §1/§2  Hardware-feeling LEDs for live reachability.
 *   - §3    `success-flash` preset on Open-browser success (one-shot overlay,
 *           480ms, fades `--accent-bg` / `--accent-border` then releases).
 *   - §8    Each LED polls its own TanStack Query; all intervals are rate-
 *           capped and share query keys with the parent so React Query dedupes
 *           the actual network call.
 *
 * All colors come from CSS variables — no hardcoded Tailwind color utilities.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  EyeOff,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  adspowerStatus,
  closeProfile,
  deleteProfile,
  listProfiles,
  listProxies,
  openProfile,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type {
  AdsPowerProfile,
  AdsPowerStatusResponse,
  AdsPowerUserProxyConfig,
  OpenProfileResult,
  StoredProxy,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Pill from "@/components/ui/Pill";
import { Led, type LedPattern, type LedTone } from "@/components/ui/LED";
import { useInspectorState } from "@/lib/ui-store";

import {
  deriveProfileStatus,
  formatAbsolute,
  formatProxyEndpoint,
  formatRelative,
} from "./profile-format";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ProfileInspectorProps {
  profile: AdsPowerProfile;
}

/** Visible length of the success-flash overlay — matches §3 `success-flash`. */
const SUCCESS_FLASH_MS = 480;

export function ProfileInspector({ profile }: ProfileInspectorProps) {
  const queryClient = useQueryClient();
  const { closeInspector } = useInspectorState();
  const [revealPassword, setRevealPassword] = useState(false);
  const status = deriveProfileStatus(profile);

  // -----------------------------------------------------------------------
  // Success flash — a non-interactive overlay that fires the §3 preset
  // once per "AdsPower returned a CDP endpoint". We re-mount the overlay by
  // bumping `flashId` instead of toggling a class so React re-runs the
  // keyframe from 0% every time.
  // -----------------------------------------------------------------------
  const [flashId, setFlashId] = useState(0);
  const triggerSuccessFlash = () => setFlashId((prev) => prev + 1);
  // Clean the overlay out of the tree after the animation completes so it
  // never leaks will-change hints or lingers in the accessibility tree.
  const [flashVisible, setFlashVisible] = useState(false);
  useEffect(() => {
    if (flashId === 0) return;
    setFlashVisible(true);
    const t = window.setTimeout(() => setFlashVisible(false), SUCCESS_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [flashId]);

  // -----------------------------------------------------------------------
  // Live-status queries — one per LED (brief §8 "Each polls its own query").
  //
  // Query keys are shared with the parent page / global health badge where
  // possible so React Query dedupes the actual HTTP request and only the
  // refetch cadence differs. If a key is new (proxies list on this route),
  // it's an additive subscription — no duplicate fetches.
  // -----------------------------------------------------------------------
  const adspowerQuery = useQuery<AdsPowerStatusResponse, Error>({
    queryKey: queryKeys.meta.adspower(),
    queryFn: ({ signal }) => adspowerStatus(signal),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  const proxiesQuery = useQuery<StoredProxy[], Error>({
    queryKey: queryKeys.proxies.list(),
    queryFn: ({ signal }) => listProxies(signal),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  const profilesQuery = useQuery<AdsPowerProfile[], Error>({
    queryKey: queryKeys.profiles.list(),
    queryFn: ({ signal }) => listProfiles(signal),
    // Match the parent page's cadence so the shared cache ticks at one rate.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });

  // -----------------------------------------------------------------------
  // Derived LED states — pure functions from the three queries + the
  // profile prop. Kept inline so the live derivation stays close to the
  // render for scanning.
  // -----------------------------------------------------------------------
  const proxyHealth = useMemo(
    () =>
      deriveProxyHealth(
        profile.user_proxy_config ?? null,
        proxiesQuery.data ?? null,
        proxiesQuery.isLoading,
        proxiesQuery.isError,
      ),
    [
      profile.user_proxy_config,
      proxiesQuery.data,
      proxiesQuery.isLoading,
      proxiesQuery.isError,
    ],
  );

  const adsPowerHealth = useMemo(
    () =>
      deriveAdsPowerHealth(
        adspowerQuery.data ?? null,
        adspowerQuery.isLoading,
        adspowerQuery.isError,
      ),
    [adspowerQuery.data, adspowerQuery.isLoading, adspowerQuery.isError],
  );

  const browserHealth = useMemo(() => {
    // Prefer the freshly-fetched list; fall back to the prop so we always
    // render *something* even before the first refetch completes.
    const fresh = findProfile(profilesQuery.data, profile.user_id) ?? profile;
    return deriveBrowserState(
      fresh,
      profilesQuery.isLoading,
      profilesQuery.isError,
    );
  }, [profilesQuery.data, profilesQuery.isLoading, profilesQuery.isError, profile]);

  // -----------------------------------------------------------------------
  // Mutations — open / close / delete
  // -----------------------------------------------------------------------
  const invalidateProfiles = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });

  const openMutation = useMutation<OpenProfileResult, Error, void>({
    mutationKey: ["profiles", "open", profile.user_id],
    mutationFn: () => openProfile(profile.user_id),
    onSuccess: (data) => {
      const cdp = extractCdpUrl(data);
      toast.success("Browser launched", {
        description: cdp
          ? `${profile.name ?? profile.user_id} · ${cdp}`
          : (profile.name ?? profile.user_id),
      });
      // §3 success-flash — fire only when AdsPower actually handed us a CDP
      // endpoint; a 200 with no CDP URL means "browser was already starting"
      // and the row-level cue would be misleading.
      if (cdp) triggerSuccessFlash();
      invalidateProfiles();
    },
    onError: (err: Error) =>
      toast.error("Could not launch browser", {
        description: err?.message ?? "AdsPower refused the request.",
      }),
  });

  const closeMutation = useMutation({
    mutationKey: ["profiles", "close", profile.user_id],
    mutationFn: () => closeProfile(profile.user_id),
    onSuccess: () => {
      toast.message("Browser closed", {
        description: profile.name ?? profile.user_id,
      });
      invalidateProfiles();
    },
    onError: (err: Error) =>
      toast.error("Could not close browser", {
        description: err?.message ?? "AdsPower refused the request.",
      }),
  });

  const deleteMutation = useMutation({
    mutationKey: ["profiles", "delete", profile.user_id],
    mutationFn: () => deleteProfile(profile.user_id),
    onSuccess: () => {
      toast.success("Profile deleted", {
        description: profile.name ?? profile.user_id,
      });
      invalidateProfiles();
      closeInspector();
    },
    onError: (err: Error) =>
      toast.error("Delete failed", {
        description: err?.message ?? "AdsPower refused the delete.",
      }),
  });

  // Fields rendered inline — everything else drops into the "Raw" block
  // so AdsPower's moving-target schema never hides from the operator.
  const EXPLICIT_KEYS = useMemo(
    () =>
      new Set([
        "user_id",
        "name",
        "group_id",
        "group_name",
        "serial_number",
        "created_time",
        "ip",
        "ip_country",
        "user_proxy_config",
      ]),
    [],
  );
  const rawExtras = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(profile)) {
      if (!EXPLICIT_KEYS.has(key)) out[key] = value;
    }
    return out;
  }, [profile, EXPLICIT_KEYS]);

  return (
    <div
      className="flex flex-col"
      style={{ gap: "20px", position: "relative" }}
    >
      {/* --- Success flash overlay -------------------------------------- */}
      {flashVisible && (
        <span
          key={`flash-${flashId}`}
          aria-hidden
          className="motion motion--success-flash"
          style={{
            position: "absolute",
            inset: "-6px",
            pointerEvents: "none",
            borderRadius: "var(--radius-lg)",
            border: "1px solid transparent",
            zIndex: 0,
          }}
        />
      )}

      {/* --- Action bar ------------------------------------------------- */}
      <div
        className="flex items-center"
        style={{ gap: "8px", flexWrap: "wrap", position: "relative", zIndex: 1 }}
      >
        <Button
          variant="primary"
          size="default"
          loading={openMutation.isPending}
          onClick={() => openMutation.mutate()}
          icon={<Play size={14} strokeWidth={1.75} aria-hidden />}
        >
          Open browser
        </Button>
        <Button
          size="default"
          loading={closeMutation.isPending}
          onClick={() => closeMutation.mutate()}
          icon={<Square size={14} strokeWidth={1.75} aria-hidden />}
        >
          Close
        </Button>
        <Button
          variant="danger"
          size="default"
          loading={deleteMutation.isPending}
          onClick={() => {
            const label = profile.name ?? profile.user_id;
            const confirmed =
              typeof window === "undefined"
                ? true
                : window.confirm(`Delete AdsPower profile "${label}"?`);
            if (confirmed) deleteMutation.mutate();
          }}
          icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden />}
        >
          Delete
        </Button>
      </div>

      {/* --- Live Status panel (three hardware LEDs) ------------------- */}
      <section
        className="flex flex-col"
        style={{ gap: "10px", position: "relative", zIndex: 1 }}
        aria-label="Live profile status"
      >
        <SectionLabel>Live Status</SectionLabel>
        <div
          className="flex flex-col"
          style={{
            gap: 0,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            background: "var(--bg-raised)",
            overflow: "hidden",
          }}
        >
          <LEDRow
            tone={proxyHealth.tone}
            pattern={proxyHealth.pattern}
            label="Proxy"
            value={proxyHealth.label}
            detail={proxyHealth.detail}
            stale={proxiesQuery.isFetching}
          />
          <LEDRow
            tone={adsPowerHealth.tone}
            pattern={adsPowerHealth.pattern}
            label="AdsPower"
            value={adsPowerHealth.label}
            detail={adsPowerHealth.detail}
            stale={adspowerQuery.isFetching}
          />
          <LEDRow
            tone={browserHealth.tone}
            pattern={browserHealth.pattern}
            label="Browser"
            value={browserHealth.label}
            detail={browserHealth.detail}
            stale={profilesQuery.isFetching}
            last
          />
        </div>
      </section>

      {/* --- Status badge ---------------------------------------------- */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>

      {/* --- Summary grid --------------------------------------------- */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <DetailGroup label="Profile">
          <DetailRow label="Name" value={profile.name ?? "—"} />
          <DetailRow label="User ID" value={profile.user_id} mono />
          <DetailRow label="Serial #" value={profile.serial_number ?? "—"} mono />
          <DetailRow
            label="Group"
            value={profile.group_name ?? profile.group_id ?? "—"}
          />
          <DetailRow
            label="Created"
            value={
              profile.created_time ? (
                <span title={formatAbsolute(profile.created_time)}>
                  {formatRelative(profile.created_time)}
                </span>
              ) : (
                "—"
              )
            }
          />
        </DetailGroup>
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>
        <DetailGroup label="Network">
          <DetailRow label="Last IP" value={profile.ip ?? "—"} mono />
          <DetailRow label="Country" value={profile.ip_country ?? "—"} />
          <DetailRow
            label="Proxy"
            value={formatProxyEndpoint(profile.user_proxy_config) ?? "—"}
            mono
          />
          <DetailRow
            label="Proxy type"
            value={profile.user_proxy_config?.proxy_type ?? "—"}
          />
          <DetailRow
            label="Proxy user"
            value={profile.user_proxy_config?.proxy_user ?? "—"}
            mono
          />
          <DetailRow
            label="Proxy password"
            mono
            value={
              <div
                className="flex items-center"
                style={{ gap: "6px", justifyContent: "flex-end" }}
              >
                <span style={{ letterSpacing: "0.04em" }}>
                  {profile.user_proxy_config?.proxy_password
                    ? revealPassword
                      ? String(profile.user_proxy_config.proxy_password)
                      : "••••••••"
                    : "—"}
                </span>
                {profile.user_proxy_config?.proxy_password ? (
                  <button
                    type="button"
                    onClick={() => setRevealPassword((prev) => !prev)}
                    aria-label={revealPassword ? "Hide password" : "Reveal password"}
                    style={{
                      color: "var(--text-muted)",
                      width: "20px",
                      height: "20px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    {revealPassword ? (
                      <EyeOff size={12} strokeWidth={1.75} aria-hidden />
                    ) : (
                      <Eye size={12} strokeWidth={1.75} aria-hidden />
                    )}
                  </button>
                ) : null}
              </div>
            }
          />
        </DetailGroup>
      </div>

      {Object.keys(rawExtras).length > 0 && (
        <div style={{ position: "relative", zIndex: 1 }}>
          <DetailGroup label="Raw (AdsPower)">
            <pre
              style={{
                margin: 0,
                padding: "12px",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                background: "var(--bg-raised)",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {safeJsonStringify(rawExtras)}
            </pre>
          </DetailGroup>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LED-row derivation helpers
// ---------------------------------------------------------------------------

interface LiveLedState {
  tone: LedTone;
  pattern: LedPattern;
  label: string;
  /** Short secondary line under the primary label — mono, muted. */
  detail?: string | null;
}

/**
 * Proxy-health LED derivation.
 *
 *   - no proxy wired                   → pending · steady · "Not wired"
 *   - proxiesQuery loading (first)     → pending · steady · "Checking…"
 *   - proxiesQuery error               → error   · fast-blink · "Unreachable"
 *   - proxy wired but no match in store→ warning · slow-pulse · "No match"
 *   - proxy wired + last_known_ip null → warning · slow-pulse · "No IP yet"
 *   - rotated >72h ago                 → warning · slow-pulse · "Stale (72h+)"
 *   - rotated 24-72h                   → success · steady · "Fresh"
 *   - rotated <24h or unknown-fresh    → success · steady · "Healthy"
 */
function deriveProxyHealth(
  cfg: AdsPowerUserProxyConfig | null,
  proxies: StoredProxy[] | null,
  loading: boolean,
  isError: boolean,
): LiveLedState {
  if (!cfg || !cfg.proxy_host) {
    return { tone: "pending", pattern: "steady", label: "Not wired", detail: null };
  }
  if (loading && proxies === null) {
    return { tone: "pending", pattern: "steady", label: "Checking…", detail: null };
  }
  if (isError) {
    return {
      tone: "error",
      pattern: "fast-blink",
      label: "Unreachable",
      detail: "proxies API error",
    };
  }
  const host = String(cfg.proxy_host).trim();
  const port = String(cfg.proxy_port ?? "").trim();
  const match = (proxies ?? []).find(
    (p) => p.host === host && String(p.port) === port,
  );
  if (!match) {
    return {
      tone: "warning",
      pattern: "slow-pulse",
      label: "No match",
      detail: port ? `${host}:${port}` : host,
    };
  }
  if (!match.last_known_ip) {
    return {
      tone: "warning",
      pattern: "slow-pulse",
      label: "No IP yet",
      detail: match.name,
    };
  }
  const rotatedAgoMs = parseIsoAgo(match.last_rotated_at);
  if (rotatedAgoMs !== null && rotatedAgoMs > 72 * 3600_000) {
    return {
      tone: "warning",
      pattern: "slow-pulse",
      label: "Stale",
      detail: `${match.last_known_ip} · rotated >72h`,
    };
  }
  return {
    tone: "success",
    pattern: "steady",
    label: "Healthy",
    detail: match.last_known_ip,
  };
}

/**
 * AdsPower bridge-reachability LED.
 *
 *   - loading (no snapshot yet)   → pending · steady · "Pinging…"
 *   - query error / unreachable   → error   · fast-blink · "Unreachable"
 *   - reachable                   → running · heartbeat · latency
 */
function deriveAdsPowerHealth(
  snap: AdsPowerStatusResponse | null,
  loading: boolean,
  isError: boolean,
): LiveLedState {
  if (loading && snap === null) {
    return { tone: "pending", pattern: "steady", label: "Pinging…", detail: null };
  }
  if (isError || !snap || !snap.reachable) {
    return {
      tone: "error",
      pattern: "fast-blink",
      label: "Unreachable",
      detail: snap?.error ?? null,
    };
  }
  return {
    tone: "running",
    pattern: "heartbeat",
    label: "Connected",
    detail:
      typeof snap.latency_ms === "number"
        ? `${Math.round(snap.latency_ms)}ms`
        : null,
  };
}

/**
 * Browser-running LED — "is this profile's Chrome session alive right now?".
 *
 * AdsPower's /user/list doesn't carry a first-class "browser_open" flag; it
 * surfaces it as a moving-target extra (`active`, `is_active`, `status`:
 * "Active" / "Closed"). We honor whichever one shows up, same as
 * deriveProfileStatus. Anything that reads as "running" → running LED with
 * pulse; closed/idle → idle LED steady; unknown → pending steady.
 */
function deriveBrowserState(
  profile: AdsPowerProfile,
  loading: boolean,
  isError: boolean,
): LiveLedState {
  if (loading) {
    return { tone: "pending", pattern: "steady", label: "Checking…", detail: null };
  }
  if (isError) {
    return {
      tone: "error",
      pattern: "fast-blink",
      label: "Status lost",
      detail: "profiles API error",
    };
  }
  const active = coerceActive(profile);
  if (active === true) {
    return {
      tone: "running",
      pattern: "pulse",
      label: "Running",
      detail: profile.ip ?? null,
    };
  }
  if (active === false) {
    return { tone: "idle", pattern: "steady", label: "Idle", detail: null };
  }
  // Unknown — profile exists but AdsPower hasn't surfaced an active signal.
  return { tone: "pending", pattern: "steady", label: "Unknown", detail: null };
}

function coerceActive(profile: AdsPowerProfile): boolean | null {
  const raw = profile["active"] ?? profile["is_active"];
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  const upstreamStatus = profile["status"];
  if (typeof upstreamStatus === "string" && upstreamStatus.length > 0) {
    const lower = upstreamStatus.toLowerCase();
    if (lower === "active" || lower === "running") return true;
    if (lower === "closed" || lower === "idle" || lower === "stopped") return false;
  }
  return null;
}

function parseIsoAgo(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  return Date.now() - t;
}

function findProfile(
  list: AdsPowerProfile[] | undefined,
  userId: string,
): AdsPowerProfile | null {
  if (!list) return null;
  for (const p of list) {
    if (p.user_id === userId) return p;
  }
  return null;
}

/**
 * Pull the first CDP/puppeteer URL out of AdsPower's start payload.
 *
 * The success-flash only fires when AdsPower hands back a real endpoint —
 * an empty 200 means "we accepted the request but the browser isn't up yet"
 * and the operator shouldn't see a green celebration for that.
 */
function extractCdpUrl(data: OpenProfileResult | null | undefined): string | null {
  if (!data) return null;
  const direct = typeof data.cdp_endpoint === "string" ? data.cdp_endpoint : null;
  if (direct && direct.length > 0) return direct;
  const pup = typeof data.ws?.puppeteer === "string" ? data.ws.puppeteer : null;
  if (pup && pup.length > 0) return pup;
  const sel = typeof data.ws?.selenium === "string" ? data.ws.selenium : null;
  if (sel && sel.length > 0) return sel;
  return null;
}

// ---------------------------------------------------------------------------
// Internal row / group primitives
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: "11px",
        lineHeight: 1.4,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--text-muted)",
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function DetailGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col" style={{ gap: "10px" }}>
      <SectionLabel>{label}</SectionLabel>
      <div
        className="flex flex-col"
        style={{
          gap: 0,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          background: "var(--bg-raised)",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between"
      style={{
        minHeight: "32px",
        padding: "6px 12px",
        gap: "12px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span
        style={{
          color: "var(--text-muted)",
          fontSize: "12px",
          lineHeight: 1.4,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        className="truncate"
        style={{
          color: "var(--text-primary)",
          fontSize: mono ? "12px" : "13px",
          lineHeight: 1.5,
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          fontVariantNumeric: mono ? "tabular-nums" : undefined,
          textAlign: "right",
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * LEDRow — one line in the Live Status panel. LED on the leading edge,
 * primary label next to it, right-aligned value + optional detail line.
 */
function LEDRow({
  tone,
  pattern,
  label,
  value,
  detail,
  stale,
  last,
}: {
  tone: LedTone;
  pattern: LedPattern;
  label: string;
  value: string;
  detail?: string | null;
  stale?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center"
      style={{
        minHeight: "40px",
        padding: "8px 12px",
        gap: "12px",
        borderBottom: last ? "none" : "1px solid var(--border)",
      }}
    >
      <Led
        tone={tone}
        pattern={pattern}
        size="md"
        glow
        label={`${label}: ${value}`}
        style={{ flexShrink: 0 }}
      />
      <span
        style={{
          color: "var(--text-muted)",
          fontSize: "12px",
          lineHeight: 1.4,
          flexShrink: 0,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <div
        className="flex flex-col"
        style={{
          marginLeft: "auto",
          alignItems: "flex-end",
          gap: "2px",
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          className="truncate"
          style={{
            color: "var(--text-primary)",
            fontSize: "12px",
            lineHeight: 1.4,
            fontWeight: 500,
            maxWidth: "100%",
            opacity: stale ? 0.85 : 1,
            transition: "opacity var(--dur-normal) var(--ease-out)",
          }}
        >
          {value}
        </span>
        {detail ? (
          <span
            className="truncate"
            style={{
              color: "var(--text-muted)",
              fontSize: "11px",
              lineHeight: 1.3,
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              maxWidth: "100%",
            }}
          >
            {detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "// unable to serialize";
  }
}

export default ProfileInspector;
