/**
 * `useSSE<T>(path)` — subscribe to a Server-Sent Events channel on the
 * configured backend.
 *
 * React 19 compatible. Uses the native `EventSource`, which:
 *   - handles reconnection with the default 3s retry;
 *   - streams JSON payloads from the FastAPI side where each `data: ...`
 *     line is `JSON.stringify(payload)`.
 *
 * The hook deliberately re-opens the connection if either the path or the
 * cached backend URL changes — `buildApiUrl(path)` is baked into the effect
 * dependency array so pointing the Settings page at a tunnel URL does the
 * right thing after one re-render.
 *
 * Contract:
 *   - `data`       — latest parsed payload, or `null` before any message.
 *   - `connected`  — true while `readyState === OPEN`.
 *   - `error`      — latest transport error message, cleared on reconnect.
 *
 * Returns the raw `EventSource` so callers can wire up custom event names
 * later (e.g. `addEventListener("snapshot", ...)`) without opening a second
 * connection. Default `message` events are already handled.
 */

import { useEffect, useRef, useState } from "react";
import { buildApiUrl } from "./api";

export interface UseSSEResult<T> {
  data: T | null;
  connected: boolean;
  error: string | null;
  /** Latest `EventSource` instance; stays stable across the connection. */
  source: EventSource | null;
}

export interface UseSSEOptions {
  /** If false, the hook holds back from opening the connection. Default: true. */
  enabled?: boolean;
  /**
   * Per-message custom parser. Return `undefined` to drop the message
   * silently (useful for ping frames). Default: `JSON.parse`.
   */
  parse?: (raw: string) => unknown;
}

const DEFAULT_PARSE = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

export function useSSE<T>(
  path: string,
  options: UseSSEOptions = {},
): UseSSEResult<T> {
  const { enabled = true, parse = DEFAULT_PARSE } = options;

  const [data, setData] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<EventSource | null>(null);

  // Keep the parser in a ref so callers passing inline arrows don't force a
  // reconnect every render.
  const parseRef = useRef(parse);
  parseRef.current = parse;

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      // SSR or very old browser — nothing to do.
      return;
    }

    // Resolve the current backend URL every mount. If the user repoints the
    // Settings page, the parent remounts us (page-level re-render) and we
    // naturally pick up the new origin.
    const url = buildApiUrl(path);

    let closed = false;
    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConnected(false);
      return;
    }

    setSource(es);
    setError(null);

    es.onopen = () => {
      if (closed) return;
      setConnected(true);
      setError(null);
    };

    es.onmessage = (ev: MessageEvent<string>) => {
      if (closed) return;
      const parsed = parseRef.current(ev.data);
      if (parsed === undefined) return;
      setData(parsed as T);
    };

    es.onerror = () => {
      if (closed) return;
      // EventSource auto-reconnects — surface the state but don't tear down.
      setConnected(es.readyState === EventSource.OPEN);
      if (es.readyState === EventSource.CLOSED) {
        setError("connection closed");
      } else {
        setError("connection interrupted (retrying)");
      }
    };

    return () => {
      closed = true;
      try {
        es.close();
      } catch {
        // Swallow — teardown is best-effort.
      }
      setSource(null);
      setConnected(false);
    };
    // `path` changes re-open deliberately. `enabled` toggles the whole
    // lifecycle. We don't need `parse` here because of the ref above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, enabled]);

  return { data, connected, error, source };
}
