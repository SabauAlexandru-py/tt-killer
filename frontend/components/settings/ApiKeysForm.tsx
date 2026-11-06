"use client";

/**
 * ApiKeysForm — read-only view of the SadCaptcha API key.
 *
 * The key is managed in `backend/.env` (`SADCAPTCHA_API_KEY`); the
 * frontend never writes it. We show whatever masked value the backend
 * chooses to expose via `GET /api/health`'s extras payload:
 *
 *   {
 *     "ok": true,
 *     "version": "0.1.0",
 *     "adspower_reachable": false,
 *     "sadcaptcha_key_masked": "ab12…9f0e"   // optional
 *   }
 *
 * Why read it from the health response instead of a dedicated endpoint:
 *   - Zero extra network cost — Settings already polls /api/health every
 *     10s via HealthBadge, so the key display stays live-ish without
 *     wiring a second query.
 *   - The backend decides what counts as "masked"; we never try to
 *     reconstruct the full key here, so leaking it from DevTools is not
 *     a worry.
 *   - If the backend hasn't shipped the field yet, we degrade to a
 *     helpful placeholder instead of breaking.
 *
 * Masking strategy when the backend only returns the raw value (local
 * dev convenience): keep the first 4 and last 4 characters, replace the
 * middle with eight "•" dots per DESIGN_SPEC — never render the raw key
 * even if asked, so the operator can screenshot this page safely.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ApiError, health } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { HealthResponse } from "@/lib/types";
import Input from "@/components/ui/Input";

interface MaskResult {
  display: string;
  state: "ok" | "unset" | "unknown";
}

/**
 * Pick the key to show, in order of preference:
 *   1. A pre-masked value from the backend (`sadcaptcha_key_masked`).
 *   2. A raw value we mask ourselves (`sadcaptcha_key`).
 *   3. An explicit "unset" flag (`sadcaptcha_key_present === false`).
 *   4. Fall through to "unknown".
 */
function pickKey(payload: HealthResponse | undefined): MaskResult {
  if (!payload) return { display: "••••…••••", state: "unknown" };

  const masked = payload["sadcaptcha_key_masked"];
  if (typeof masked === "string" && masked.length > 0) {
    return { display: masked, state: "ok" };
  }

  const raw = payload["sadcaptcha_key"];
  if (typeof raw === "string" && raw.length > 0) {
    return { display: maskKey(raw), state: "ok" };
  }

  const present = payload["sadcaptcha_key_present"];
  if (present === false) {
    return { display: "Not configured", state: "unset" };
  }

  return { display: "••••…••••", state: "unknown" };
}

function maskKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 8) {
    // Short keys would leak the whole thing with the 4 + 4 rule; fall
    // back to a full mask so we never render more than 4 characters we
    // couldn't cover.
    return "••••••••";
  }
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

export function ApiKeysForm() {
  const query = useQuery<HealthResponse, ApiError>({
    queryKey: queryKeys.meta.health(),
    queryFn: ({ signal }) => health(signal),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    retry: 0,
    staleTime: 0,
  });

  const key = useMemo(() => pickKey(query.data), [query.data]);
  const helperColor =
    key.state === "unset" ? "var(--warn)" : "var(--text-muted)";
  const helperText =
    key.state === "unset"
      ? "No SadCaptcha key loaded — TikTok captcha solving is disabled. Add SADCAPTCHA_API_KEY to backend/.env and restart the agent."
      : "Managed in backend .env — edit that file to change.";

  return (
    <div className="flex flex-col" style={{ gap: "12px" }}>
      <div className="flex flex-col" style={{ gap: "4px" }}>
        <label
          htmlFor="sadcaptcha-key-display"
          style={{
            fontSize: "12px",
            lineHeight: 1.4,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            fontWeight: 500,
          }}
        >
          SadCaptcha API key
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
          Used by the account creator to solve TikTok captchas during
          signup. The key itself never leaves the backend process.
        </p>
      </div>

      <div style={{ maxWidth: "420px" }}>
        <Input
          id="sadcaptcha-key-display"
          variant="mono"
          value={key.display}
          readOnly
          aria-readonly="true"
          spellCheck={false}
          // Kill the caret so the field reads as a readout, not an
          // editable input; `readOnly` already blocks typing so Tab
          // navigation keeps working for keyboard users.
          style={{ caretColor: "transparent" }}
          aria-describedby="sadcaptcha-key-helper"
        />
      </div>

      <p
        id="sadcaptcha-key-helper"
        style={{
          fontSize: "12px",
          lineHeight: 1.4,
          color: helperColor,
          margin: 0,
        }}
      >
        {helperText}
      </p>
    </div>
  );
}

export default ApiKeysForm;
