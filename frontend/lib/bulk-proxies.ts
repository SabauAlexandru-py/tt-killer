/**
 * Bulk proxy paste parser.
 *
 * Consumes a raw multi-line textarea blob from `ProxyBulkForm` and splits it
 * into clean `ParsedBulkProxy` rows plus a sidecar list of skipped lines the
 * UI can show the operator. The server-side endpoint
 * (`POST /api/proxies/bulk-text`) runs its own canonical parser — this
 * client-side pass exists so the "Will add 12 proxies · 2 lines skipped"
 * preview can update instantly without a round trip.
 *
 * Accepted formats (DESIGN_BRIEF_V2 §6, pruned to the subset the task
 * exposes in the UI placeholder):
 *
 *   1. host:port:user:pass          → http, with basic auth
 *   2. host:port                    → http, no auth
 *   3. scheme://user:pass@host:port → scheme in {http, https, socks5, socks5h}
 *   4. scheme://host:port           → scheme in {http, https, socks5, socks5h}
 *
 * Rules:
 *   - Lines are trimmed. Empty lines are ignored (not counted as skipped).
 *   - Lines starting with `#` are comments, also silently ignored.
 *   - Default scheme is `http` when a line omits it.
 *   - `socks5h` is normalised to `socks5` — the backend already treats them
 *     the same (SOCKS5 with remote DNS is a client flag, not a stored
 *     property).
 *   - `socks4`, unknown schemes, ports outside 1–65535 and lines that don't
 *     match any grammar land in `skipped` with a human-readable reason. We
 *     never throw.
 *   - Within-paste duplicates (same `host:port`) are rejected after the first
 *     occurrence so the preview matches the server's dedupe rule.
 *   - The raw line is preserved in both the valid and skipped entries so the
 *     UI can render it with credentials redacted when needed.
 */

export type ParsedProxyType = "http" | "https" | "socks5";

export interface ParsedBulkProxy {
  /** 1-based line number in the original text. */
  lineNumber: number;
  host: string;
  port: number;
  type: ParsedProxyType;
  user: string | null;
  password: string | null;
  /** Original line, untrimmed of credentials (the caller may redact). */
  raw: string;
}

export interface SkippedBulkLine {
  /** 1-based line number in the original text. */
  lineNumber: number;
  /** Operator-facing explanation. Keep terse — this surfaces in a toast. */
  reason: string;
  raw: string;
}

export interface BulkParseResult {
  valid: ParsedBulkProxy[];
  skipped: SkippedBulkLine[];
  /** Non-empty, non-comment lines seen. `valid.length + skipped.length`. */
  totalLines: number;
}

// ---------------------------------------------------------------------------
// Scheme normalisation
// ---------------------------------------------------------------------------

const SCHEME_MAP: Record<string, ParsedProxyType> = {
  http: "http",
  https: "https",
  socks5: "socks5",
  socks5h: "socks5", // remote DNS flavour — stored as socks5
};

function normaliseScheme(raw: string): ParsedProxyType | null {
  const key = raw.toLowerCase();
  return SCHEME_MAP[key] ?? null;
}

// ---------------------------------------------------------------------------
// Port validation
// ---------------------------------------------------------------------------

function parsePort(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Host validation — permissive. Reject only obviously broken shapes so
// tomorrow's DNS tricks don't trip the parser. The backend does the real
// reachability check.
// ---------------------------------------------------------------------------

function isHostish(raw: string): boolean {
  if (!raw) return false;
  if (/\s/.test(raw)) return false;
  // Minimum sanity: at least one letter-or-digit character.
  return /[A-Za-z0-9]/.test(raw);
}

// ---------------------------------------------------------------------------
// URI form:  scheme://[user[:pass]@]host:port
// ---------------------------------------------------------------------------

function tryParseUri(line: string): Omit<ParsedBulkProxy, "lineNumber" | "raw"> | string {
  // Fast reject — must look like a URI.
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(line);
  if (!schemeMatch) return "not a URI";
  const schemeRaw = schemeMatch[1]!;
  const scheme = normaliseScheme(schemeRaw);
  if (!scheme) return `scheme "${schemeRaw}" not supported (http, https, socks5, socks5h)`;

  const rest = line.slice(schemeMatch[0].length);
  if (!rest) return "missing host";

  // Split on the LAST `@` — passwords may contain `@`.
  let auth = "";
  let hostPart = rest;
  const atIndex = rest.lastIndexOf("@");
  if (atIndex !== -1) {
    auth = rest.slice(0, atIndex);
    hostPart = rest.slice(atIndex + 1);
  }

  // Strip any trailing path/query — we don't store it and the backend ignores
  // it too. Operators sometimes paste `scheme://host:port/` with a stray slash.
  const pathCut = hostPart.search(/[/?#]/);
  if (pathCut !== -1) hostPart = hostPart.slice(0, pathCut);

  const colonIndex = hostPart.lastIndexOf(":");
  if (colonIndex === -1) return "missing port";
  const host = hostPart.slice(0, colonIndex);
  const portRaw = hostPart.slice(colonIndex + 1);
  if (!isHostish(host)) return "invalid host";
  const port = parsePort(portRaw);
  if (port === null) return `invalid port "${portRaw}"`;

  let user: string | null = null;
  let password: string | null = null;
  if (auth) {
    const authColon = auth.indexOf(":");
    if (authColon === -1) {
      user = auth || null;
    } else {
      user = auth.slice(0, authColon) || null;
      password = auth.slice(authColon + 1) || null;
    }
  }

  return { host, port, type: scheme, user, password };
}

// ---------------------------------------------------------------------------
// CSV forms:  host:port  or  host:port:user:pass
// The password may contain `:`, so we split into AT MOST 4 segments.
// ---------------------------------------------------------------------------

function tryParseCsv(line: string): Omit<ParsedBulkProxy, "lineNumber" | "raw"> | string {
  // Reject URI-looking lines early so the caller's `tryParseUri` always wins.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(line)) return "URI-shaped";
  if (!line.includes(":")) return "missing port";

  const parts = line.split(":");
  if (parts.length === 2) {
    const [hostRaw, portRaw] = parts as [string, string];
    const host = hostRaw.trim();
    if (!isHostish(host)) return "invalid host";
    const port = parsePort(portRaw.trim());
    if (port === null) return `invalid port "${portRaw}"`;
    return { host, port, type: "http", user: null, password: null };
  }

  if (parts.length >= 4) {
    const host = parts[0]!.trim();
    const portRaw = parts[1]!.trim();
    const user = parts[2] ?? "";
    // Re-join the tail so a password containing `:` survives.
    const password = parts.slice(3).join(":");
    if (!isHostish(host)) return "invalid host";
    const port = parsePort(portRaw);
    if (port === null) return `invalid port "${portRaw}"`;
    return {
      host,
      port,
      type: "http",
      user: user.length > 0 ? user : null,
      password: password.length > 0 ? password : null,
    };
  }

  return "expected host:port or host:port:user:pass";
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

function parseOneLine(
  line: string,
): Omit<ParsedBulkProxy, "lineNumber" | "raw"> | { error: string } {
  // URI first — a line like `http://1.2.3.4:80` must not be mistaken for CSV.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(line)) {
    const uri = tryParseUri(line);
    if (typeof uri === "string") return { error: uri };
    return uri;
  }
  const csv = tryParseCsv(line);
  if (typeof csv === "string") return { error: csv };
  return csv;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function parseBulkProxyLines(text: string): BulkParseResult {
  const valid: ParsedBulkProxy[] = [];
  const skipped: SkippedBulkLine[] = [];
  const seen = new Set<string>();

  if (typeof text !== "string" || text.length === 0) {
    return { valid, skipped, totalLines: 0 };
  }

  const lines = text.split(/\r?\n/);
  let totalLines = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;

    totalLines += 1;
    const lineNumber = i + 1;
    const parsed = parseOneLine(trimmed);

    if ("error" in parsed) {
      skipped.push({ lineNumber, reason: parsed.error, raw });
      continue;
    }

    const key = `${parsed.host.toLowerCase()}:${parsed.port}`;
    if (seen.has(key)) {
      skipped.push({
        lineNumber,
        reason: `duplicate ${parsed.host}:${parsed.port}`,
        raw,
      });
      continue;
    }
    seen.add(key);

    valid.push({ ...parsed, lineNumber, raw });
  }

  return { valid, skipped, totalLines };
}

// ---------------------------------------------------------------------------
// Convenience: human summary used both in the inline hint and the toast.
// ---------------------------------------------------------------------------

export function summariseParseResult(result: BulkParseResult): string {
  const { valid, skipped } = result;
  if (valid.length === 0 && skipped.length === 0) {
    return "Paste lines in any of the four formats above.";
  }
  const addPart = `Will add ${valid.length} ${valid.length === 1 ? "proxy" : "proxies"}`;
  if (skipped.length === 0) return addPart;
  return `${addPart} · ${skipped.length} ${skipped.length === 1 ? "line" : "lines"} skipped`;
}
