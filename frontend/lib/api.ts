/**
 * Typed API client for the FastAPI backend.
 *
 * Every function wraps `fetch` with:
 *   - Base URL from `localStorage['adspower-backend-url']` (fallback
 *     http://localhost:8080) so the operator can repoint at a Cloudflare
 *     Tunnel from the Settings page.
 *   - `Accept: application/json` on every request and
 *     `Content-Type: application/json` on every request that carries a body.
 *   - Throw-on-!res.ok with a readable `ApiError` carrying status + body text.
 *   - A typed return shaped by the T generic — callers never parse manually.
 *
 * The functions are grouped by resource (proxies, profiles, runs, meta) to
 * match the backend routers 1:1. TanStack Query mutations live in the pages
 * themselves; this file stays transport-only.
 */

import type {
  AdsPowerProfile,
  AdsPowerStatusResponse,
  BulkProxyTextRequest,
  BulkProxyTextResponse,
  CapacityResponse,
  CreateAccountsRequest,
  CreateProxyRequest,
  HealthResponse,
  OpenProfileResult,
  RotateProxyResult,
  RunCreatedResponse,
  RunSnapshot,
  StoredProxy,
  SyncProfilesResult,
  UpdateProxyRequest,
  VerifyProxyIpResult,
  WarmupAccountsRequest,
} from "./types";

// ---------------------------------------------------------------------------
// Backend URL resolution
// ---------------------------------------------------------------------------

export const BACKEND_URL_STORAGE_KEY = "adspower-backend-url";
export const DEFAULT_BACKEND_URL = "http://localhost:8080";

/**
 * Return the currently-configured backend origin (no trailing slash).
 *
 * Reads from localStorage when available; falls back to
 * `http://localhost:8080` during SSR and when the user hasn't set anything.
 * Never throws — a corrupt value falls back silently.
 */
export function getBackendUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BACKEND_URL;
  try {
    const raw = window.localStorage.getItem(BACKEND_URL_STORAGE_KEY);
    if (!raw) return DEFAULT_BACKEND_URL;
    const trimmed = raw.trim().replace(/\/+$/, "");
    return trimmed.length > 0 ? trimmed : DEFAULT_BACKEND_URL;
  } catch {
    return DEFAULT_BACKEND_URL;
  }
}

/** Persist the backend URL (Settings page). No-op on SSR / blocked storage. */
export function setBackendUrl(url: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      BACKEND_URL_STORAGE_KEY,
      url.trim().replace(/\/+$/, ""),
    );
  } catch {
    // Storage blocked (private window, strict CSP) — ignore.
  }
}

// ---------------------------------------------------------------------------
// Low-level fetch wrapper
// ---------------------------------------------------------------------------

/** Error thrown for any non-2xx response. `body` is the raw text. */
export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;
  readonly url: string;

  constructor(opts: {
    status: number;
    statusText: string;
    body: string;
    url: string;
  }) {
    const preview = opts.body.length > 180 ? `${opts.body.slice(0, 180)}…` : opts.body;
    super(
      `${opts.status} ${opts.statusText || "Error"} — ${opts.url}${
        preview ? `: ${preview}` : ""
      }`,
    );
    this.name = "ApiError";
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.body = opts.body;
    this.url = opts.url;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Join the configured backend URL with a path, keeping exactly one slash.
 * Exported so the SSE hook can build EventSource URLs the same way.
 */
export function buildApiUrl(path: string): string {
  const base = getBackendUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = opts;
  const url = buildApiUrl(path);

  const headers: Record<string, string> = { Accept: "application/json" };
  let serializedBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    headers["Content-Type"] = "application/json";
    serializedBody = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: serializedBody,
      signal,
      // No credentials — backend is CORS-open for the configured origins and
      // we don't ship cookies to a local-only service.
      credentials: "omit",
      cache: "no-store",
    });
  } catch (err) {
    // Network error (DNS failure, backend down, CORS reject at browser layer).
    const detail = err instanceof Error ? err.message : String(err);
    throw new ApiError({
      status: 0,
      statusText: "Network error",
      body: detail,
      url,
    });
  }

  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      // Body already consumed or unreadable — leave empty.
    }
    throw new ApiError({
      status: res.status,
      statusText: res.statusText,
      body: text,
      url,
    });
  }

  // 204 No Content — common on idempotent deletes.
  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    // Backend should always speak JSON, but don't trip over a 200 OK body of
    // "" from a misbehaving middleware.
    return undefined as T;
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Proxies
// ---------------------------------------------------------------------------

export const listProxies = (signal?: AbortSignal) =>
  request<StoredProxy[]>("/api/proxies", { signal });

export const createProxy = (payload: CreateProxyRequest) =>
  request<StoredProxy>("/api/proxies", { method: "POST", body: payload });

export const bulkCreateProxiesByText = (payload: BulkProxyTextRequest) =>
  request<BulkProxyTextResponse>("/api/proxies/bulk-text", {
    method: "POST",
    body: payload,
  });

export const updateProxy = (id: string, patch: UpdateProxyRequest) =>
  request<StoredProxy>(`/api/proxies/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
  });

export const deleteProxy = (id: string) =>
  request<{ ok: boolean }>(`/api/proxies/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

export const rotateProxy = (id: string) =>
  request<RotateProxyResult>(
    `/api/proxies/${encodeURIComponent(id)}/rotate`,
    { method: "POST" },
  );

export const verifyProxyIp = (id: string) =>
  request<VerifyProxyIpResult>(
    `/api/proxies/${encodeURIComponent(id)}/verify-ip`,
    { method: "POST" },
  );

// ---------------------------------------------------------------------------
// Profiles (AdsPower passthrough)
// ---------------------------------------------------------------------------

export const listProfiles = (signal?: AbortSignal) =>
  request<AdsPowerProfile[]>("/api/profiles", { signal });

export const syncProfiles = () =>
  request<SyncProfilesResult>("/api/profiles/sync", { method: "POST" });

export const deleteProfile = (userId: string) =>
  request<{ ok: boolean }>(
    `/api/profiles/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );

export const openProfile = (userId: string) =>
  request<OpenProfileResult>(
    `/api/profiles/${encodeURIComponent(userId)}/open`,
    { method: "POST" },
  );

export const closeProfile = (userId: string) =>
  request<{ ok: boolean }>(
    `/api/profiles/${encodeURIComponent(userId)}/close`,
    { method: "POST" },
  );

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const listRuns = (signal?: AbortSignal) =>
  request<RunSnapshot[]>("/api/runs", { signal });

export const getRun = (runId: string, signal?: AbortSignal) =>
  request<RunSnapshot>(`/api/runs/${encodeURIComponent(runId)}`, { signal });

export const createAccountsRun = (payload: CreateAccountsRequest) =>
  request<RunCreatedResponse>("/api/runs/create", {
    method: "POST",
    body: payload,
  });

export const warmupAccountsRun = (payload: WarmupAccountsRequest) =>
  request<RunCreatedResponse>("/api/runs/warmup", {
    method: "POST",
    body: payload,
  });

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export const health = (signal?: AbortSignal) =>
  request<HealthResponse>("/api/health", { signal });

export const adspowerStatus = (signal?: AbortSignal) =>
  request<AdsPowerStatusResponse>("/api/adspower/status", { signal });

/**
 * Fetch proxy/profile/suggested-concurrency counts for the N-selector.
 *
 * Tries `/api/meta/capacity` first (DESIGN_BRIEF_V2 §5 locked path), then
 * falls back to `/api/capacity` — the current backend mounts the capacity
 * route under /api without a /meta segment, so we tolerate either until the
 * routing is harmonized. A 404 on both paths surfaces as the normal ApiError
 * so the dialog can show an error state.
 */
export const getCapacity = async (
  signal?: AbortSignal,
): Promise<CapacityResponse> => {
  try {
    return await request<CapacityResponse>("/api/meta/capacity", { signal });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return await request<CapacityResponse>("/api/capacity", { signal });
    }
    throw err;
  }
};
