"use client";

/**
 * BackendUrlField — the text input that controls `getBackendUrl()`.
 *
 * Reads and writes `localStorage['adspower-backend-url']` through the
 * typed helpers in `lib/api.ts` so this component and the fetch client
 * can never disagree on the key name or trimming rules.
 *
 * Behaviour:
 *   - Mount: hydrate the input from `getBackendUrl()` inside an effect
 *     (never in the first render — the server renders this page as
 *     "use client" but Next.js still renders it on the server for
 *     routing, and `window.localStorage` is undefined there).
 *   - Installer handshake (V2 Shape-B): if the URL carries
 *     `?backend=<url>`, auto-populate the field, auto-save, strip the
 *     query so a refresh does not loop the toast, and announce
 *     "Backend URL loaded from installer." via sonner. This is what the
 *     start.sh script fires to hand its Cloudflare Tunnel URL to a
 *     Vercel-hosted panel in one click.
 *   - Edit: tracked locally in `draft`; the field is "dirty" when
 *     `draft !== saved`.
 *   - Save: trims trailing slashes (via `setBackendUrl`), updates
 *     `saved`, and bumps `probeKey` so the health LED + HealthBadge
 *     re-query on the new origin immediately rather than waiting for
 *     their 10s tick.
 *   - Reset: one-click return to the default `http://localhost:8080`.
 *   - Validation: lightweight — must parse as a URL and use http(s).
 *     We don't try harder because Cloudflare Tunnel hostnames are a
 *     moving target and the HealthBadge is the real source of truth.
 *   - Live LED beside Save: shares a TanStack Query with HealthBadge
 *     (identical queryKey → one in-flight request). Mapping follows
 *     DESIGN_BRIEF_V2 §2:
 *       steady green      → backend reachable
 *       slow-pulse amber  → checking (first probe in flight)
 *       fast-blink red    → unreachable
 *
 * Layout: label row → input + Save (with inline LED) + Reset → helper
 * copy → HealthBadge. All spacing and color come from CSS variables; no
 * hardcoded tones.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ApiError,
  DEFAULT_BACKEND_URL,
  getBackendUrl,
  health,
  setBackendUrl,
} from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { Led, type LedPattern, type LedTone } from "@/components/ui/LED";
import type { HealthResponse } from "@/lib/types";
import { HealthBadge } from "./HealthBadge";

interface ValidationResult {
  valid: boolean;
  message: string | null;
}

function validate(raw: string): ValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, message: "Backend URL cannot be empty." };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      message: "Enter a full URL, like http://localhost:8080.",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      message: "Only http:// and https:// backends are supported.",
    };
  }
  return { valid: true, message: null };
}

function normalize(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/**
 * Pull the `?backend=<url>` query param off `window.location` without
 * forcing the Settings page under a `<Suspense>` boundary (which
 * `useSearchParams` in Next.js 15 would demand for static generation).
 * Returns the raw param string so the caller can run it through the
 * same validate() + normalize() as a manual paste.
 */
function readInstallerParam(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("backend");
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Remove `?backend=...` from the address bar after we've consumed it so
 * a refresh doesn't fire the installer toast a second time. Uses
 * `history.replaceState` — no navigation, no scroll jump, no SSR round
 * trip. If other params exist they survive untouched.
 */
function stripInstallerParam(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("backend")) return;
    url.searchParams.delete("backend");
    const nextSearch = url.searchParams.toString();
    const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  } catch {
    /* non-fatal — the toast already fired and the URL stays as-is */
  }
}

interface LedState {
  tone: LedTone;
  pattern: LedPattern;
  label: string;
}

export function BackendUrlField() {
  const [saved, setSaved] = useState<string>(DEFAULT_BACKEND_URL);
  const [draft, setDraft] = useState<string>(DEFAULT_BACKEND_URL);
  const [hydrated, setHydrated] = useState<boolean>(false);
  // Changing this forces HealthBadge's + inline-LED's query key to
  // change on Save so the probe re-runs against the new origin
  // immediately.
  const [probeKey, setProbeKey] = useState<string>(DEFAULT_BACKEND_URL);
  // Guards against the installer toast firing twice when React 19's
  // StrictMode double-invokes effects in dev.
  const installerConsumedRef = useRef<boolean>(false);

  useEffect(() => {
    const installer = readInstallerParam();
    const existing = getBackendUrl();

    if (installer && !installerConsumedRef.current) {
      const validation = validate(installer);
      if (validation.valid) {
        const normalized = normalize(installer);
        setBackendUrl(normalized);
        setSaved(normalized);
        setDraft(normalized);
        setProbeKey(normalized);
        installerConsumedRef.current = true;
        stripInstallerParam();
        toast.success("Backend URL loaded from installer.", {
          description: normalized,
        });
      } else {
        // Keep the user's existing URL; show them what came in so they
        // can see the installer sent garbage without silently dropping
        // it.
        setSaved(existing);
        setDraft(existing);
        setProbeKey(existing);
        installerConsumedRef.current = true;
        stripInstallerParam();
        toast.error("Installer sent an invalid backend URL.", {
          description: validation.message ?? installer,
        });
      }
    } else {
      setSaved(existing);
      setDraft(existing);
      setProbeKey(existing);
    }

    setHydrated(true);
  }, []);

  const validation = useMemo(() => validate(draft), [draft]);
  const normalizedDraft = useMemo(() => normalize(draft), [draft]);
  const isDirty = hydrated && normalizedDraft !== saved;
  const canSave = hydrated && validation.valid && isDirty;
  const isDefault = saved === DEFAULT_BACKEND_URL;

  const handleSave = useCallback(() => {
    if (!canSave) return;
    setBackendUrl(normalizedDraft);
    setSaved(normalizedDraft);
    setDraft(normalizedDraft);
    setProbeKey(normalizedDraft);
  }, [canSave, normalizedDraft]);

  const handleReset = useCallback(() => {
    setBackendUrl(DEFAULT_BACKEND_URL);
    setSaved(DEFAULT_BACKEND_URL);
    setDraft(DEFAULT_BACKEND_URL);
    setProbeKey(DEFAULT_BACKEND_URL);
  }, []);

  // Inline health probe. Identical queryKey to <HealthBadge/> below so
  // TanStack Query serves both consumers from one in-flight request and
  // the two indicators can never disagree by a tick.
  const healthQuery = useQuery<HealthResponse, ApiError>({
    queryKey: [...queryKeys.meta.health(), probeKey],
    queryFn: ({ signal }) => health(signal),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    retry: 0,
    staleTime: 0,
    enabled: hydrated,
  });

  const ledState = useMemo<LedState>(() => {
    if (!hydrated || (healthQuery.isPending && !healthQuery.data)) {
      return {
        tone: "warning",
        pattern: "slow-pulse",
        label: "Checking backend…",
      };
    }
    if (healthQuery.isError || !healthQuery.data?.ok) {
      return {
        tone: "error",
        pattern: "fast-blink",
        label: "Backend unreachable",
      };
    }
    return {
      tone: "success",
      pattern: "steady",
      label: "Backend reachable",
    };
  }, [
    hydrated,
    healthQuery.data,
    healthQuery.isError,
    healthQuery.isPending,
  ]);

  return (
    <div className="flex flex-col" style={{ gap: "12px" }}>
      <div className="flex flex-col" style={{ gap: "4px" }}>
        <label
          htmlFor="backend-url-input"
          style={{
            fontSize: "12px",
            lineHeight: 1.4,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            fontWeight: 500,
          }}
        >
          Backend URL
        </label>
        <p
          style={{
            fontSize: "13px",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            margin: 0,
            maxWidth: "72ch",
          }}
        >
          Origin the frontend talks to. Default works when the agent runs on
          the same machine as this UI; swap in a Cloudflare Tunnel URL when
          the frontend is hosted elsewhere. The installer can hand this URL
          in via <code style={{ fontFamily: "var(--font-mono)" }}>?backend=</code>
          — the field will populate and save on its own.
        </p>
      </div>

      <div
        className="flex flex-wrap items-start"
        style={{ gap: "8px" }}
      >
        <div style={{ flex: "1 1 320px", minWidth: "240px" }}>
          <Input
            id="backend-url-input"
            variant="mono"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={DEFAULT_BACKEND_URL}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
            aria-invalid={!validation.valid && isDirty ? true : undefined}
            aria-describedby={
              validation.message ? "backend-url-error" : undefined
            }
          />
        </div>
        <div
          className="inline-flex items-center"
          style={{ gap: "10px", height: "44px" }}
        >
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={handleSave}
            aria-label="Save backend URL"
          >
            Save
          </Button>
          <Led
            tone={ledState.tone}
            pattern={ledState.pattern}
            size="md"
            glow
            label={ledState.label}
            title={ledState.label}
          />
        </div>
        <Button
          variant="ghost"
          disabled={isDefault && !isDirty}
          onClick={handleReset}
          aria-label="Reset backend URL to default"
        >
          Reset
        </Button>
      </div>

      {validation.message && isDirty ? (
        <p
          id="backend-url-error"
          role="alert"
          style={{
            fontSize: "12px",
            lineHeight: 1.4,
            color: "var(--error)",
            margin: 0,
          }}
        >
          {validation.message}
        </p>
      ) : null}

      <div
        className="flex flex-col"
        style={{
          gap: "8px",
          padding: "12px 16px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <span
          style={{
            fontSize: "12px",
            lineHeight: 1.4,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            fontWeight: 500,
          }}
        >
          Live status
        </span>
        <HealthBadge backendUrl={probeKey} />
      </div>
    </div>
  );
}

export default BackendUrlField;
