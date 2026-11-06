"use client";

/**
 * CloudflareTunnelCard — informational card with the one-liner that
 * exposes the local agent to a Vercel-hosted frontend.
 *
 * Why this card exists:
 *   DESIGN_SPEC § "Vercel + localhost strategy" step 4 locks the tunnel
 *   command and expects the Settings page to link to the deployment
 *   doc. Shipping the exact command inline avoids the operator having
 *   to crack open the docs just to copy a single line.
 *
 * Interaction:
 *   - The command is a click-to-copy block. On success the button
 *     flips to "Copied" for 1.5s via a timer that we clean up on
 *     unmount (guards against a double-click triggering two timers).
 *   - When the Clipboard API is unavailable (older Safari, strict CSP,
 *     non-secure context), the button hides itself and a "Select the
 *     text manually" tooltip appears, so the card stays useful.
 *
 * Styling: the command block is monospaced, uses --bg-raised so it reads
 * as a sibling of the surrounding --bg-surface card. No shadows, no
 * gradients — strictly Mission Control.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";

const TUNNEL_COMMAND = "cloudflared tunnel --url http://localhost:8080";
const DEPLOYMENT_DOC_PATH = "/docs/deployment.md";

export function CloudflareTunnelCard() {
  const [copied, setCopied] = useState<boolean>(false);
  const [clipboardSupported, setClipboardSupported] = useState<boolean>(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Detect once on mount to avoid rendering a button that silently
    // throws. `window.isSecureContext` matters because clipboard-write
    // on http://non-localhost is blocked by every modern browser.
    if (typeof navigator === "undefined") {
      setClipboardSupported(false);
      return;
    }
    const hasApi =
      typeof navigator.clipboard?.writeText === "function" &&
      // `isSecureContext` is true for localhost and https: pages.
      (typeof window === "undefined" || window.isSecureContext !== false);
    setClipboardSupported(Boolean(hasApi));
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(TUNNEL_COMMAND);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Permission denied at runtime — degrade to manual-select mode.
      setClipboardSupported(false);
    }
  }, []);

  return (
    <aside
      aria-labelledby="tunnel-card-title"
      className="flex flex-col"
      style={{
        gap: "12px",
        padding: "16px 20px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <header className="flex flex-col" style={{ gap: "4px" }}>
        <h3
          id="tunnel-card-title"
          style={{
            fontSize: "14px",
            lineHeight: 1.4,
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          Expose the local agent (Cloudflare Tunnel)
        </h3>
        <p
          style={{
            fontSize: "13px",
            lineHeight: 1.5,
            color: "var(--text-secondary)",
            margin: 0,
            maxWidth: "72ch",
          }}
        >
          Hosting the frontend on Vercel? AdsPower only listens on your
          laptop, so the browser needs a public URL that forwards back to
          localhost. Cloudflare Tunnel gives you a throwaway{" "}
          <span className="font-mono-data">*.trycloudflare.com</span>{" "}
          hostname in one command — paste that into the Backend URL field
          above.
        </p>
      </header>

      <div
        className="flex items-center"
        style={{
          gap: "8px",
          padding: "10px 12px",
          background: "var(--bg-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <code
          className="font-mono-data"
          style={{
            flex: 1,
            minWidth: 0,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
            overflowX: "auto",
            userSelect: "all",
          }}
          aria-label="Cloudflare Tunnel command"
        >
          {TUNNEL_COMMAND}
        </code>
        {clipboardSupported ? (
          <Button
            size="sm"
            variant="default"
            onClick={handleCopy}
            aria-label={copied ? "Command copied" : "Copy command"}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        ) : (
          <span
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
            }}
          >
            Select and copy
          </span>
        )}
      </div>

      <ol
        className="flex flex-col"
        style={{
          gap: "6px",
          margin: 0,
          padding: 0,
          listStyle: "none",
          counterReset: "tunnel-step",
        }}
      >
        {[
          <>
            Install{" "}
            <span className="font-mono-data">cloudflared</span> — macOS:
            {" "}
            <span className="font-mono-data">brew install cloudflared</span>.
          </>,
          <>
            Run the command above. The output includes a URL of the form{" "}
            <span className="font-mono-data">
              https://&lt;random&gt;.trycloudflare.com
            </span>
            .
          </>,
          <>
            Paste that URL into <strong>Backend URL</strong> above and press
            <strong> Save</strong>. The status badge should flip to{" "}
            <em>Backend reachable</em> within a few seconds.
          </>,
          <>
            Keep the terminal running — closing it drops the tunnel. For a
            durable deployment, use a named tunnel instead.
          </>,
        ].map((step, index) => (
          <li
            key={index}
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "baseline",
              fontSize: "13px",
              lineHeight: 1.5,
              color: "var(--text-secondary)",
            }}
          >
            <span
              aria-hidden="true"
              className="font-mono-data"
              style={{
                color: "var(--text-muted)",
                width: "20px",
                flexShrink: 0,
              }}
            >
              {index + 1}.
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <footer
        className="flex items-center"
        style={{
          gap: "6px",
          fontSize: "12px",
          color: "var(--text-muted)",
          lineHeight: 1.4,
        }}
      >
        <span>Full walkthrough and named-tunnel setup:</span>
        <a
          href={DEPLOYMENT_DOC_PATH}
          target="_blank"
          rel="noreferrer"
          style={{
            color: "var(--accent)",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
          }}
        >
          docs/deployment.md
        </a>
      </footer>
    </aside>
  );
}

export default CloudflareTunnelCard;
