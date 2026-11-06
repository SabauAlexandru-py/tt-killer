/**
 * TypeScript shapes that mirror the FastAPI backend 1:1.
 *
 * Field names stay snake_case because:
 *   1. the backend returns JSON as pydantic dumps it (snake_case), and
 *   2. inventing a camelCase layer here would mean translating in every
 *      component — error-prone for a dense terminal-style UI where the
 *      same field appears in a table, an inspector, and a log line.
 *
 * When a type is a passthrough of an AdsPower upstream payload (profiles,
 * browser start info, created account) we accept unknown extras via an
 * index signature — AdsPower's Local API returns a moving target and we
 * never want a stray field to crash the renderer.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type ProxyType = "http" | "https" | "socks5";

export type AccountStatus = "pending" | "running" | "complete" | "failed";
export type RunStatus = "running" | "complete" | "failed";
export type RunKind = "create" | "warmup";

/**
 * Catch-all for AdsPower passthrough blobs that may carry extra vendor
 * fields we don't know about yet.
 */
export type Extras = Readonly<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Proxies (local JSON store — see backend/backend/store.py)
// ---------------------------------------------------------------------------

export interface StoredProxy {
  id: string;
  name: string;
  host: string;
  port: number;
  type: ProxyType;
  user: string | null;
  password: string | null;
  rotation_url: string | null;
  last_known_ip: string | null;
  last_rotated_at: string | null;
  created_at: string;
}

/** Body for `POST /api/proxies`. Server mints id + created_at. */
export interface CreateProxyRequest {
  name: string;
  host: string;
  port: number;
  type: ProxyType;
  user?: string | null;
  password?: string | null;
  rotation_url?: string | null;
}

/** Body for `PATCH /api/proxies/{id}`. All fields optional. */
export type UpdateProxyRequest = Partial<CreateProxyRequest>;

/** Body for `POST /api/proxies/bulk-text`. */
export interface BulkProxyTextRequest {
  text: string;
}

/** Response from `POST /api/proxies/bulk-text`. */
export interface BulkProxyTextResponse {
  /** 1-based line numbers that produced a stored proxy, with the new id. */
  inserted: Array<{ line: number; id: string }>;
  /** Lines rejected for being duplicates of something already stored. */
  skipped: Array<{ line: number; reason: string }>;
  /** Lines that failed validation. `input` is already redacted by the server. */
  errors: Array<{ line: number; reason: string; input: string }>;
}

/** Result of `POST /api/proxies/{id}/rotate`. */
export interface RotateProxyResult {
  old_ip: string | null;
  new_ip: string | null;
  changed: boolean;
}

/** Result of `POST /api/proxies/{id}/verify-ip`. */
export interface VerifyProxyIpResult {
  ip: string;
}

// ---------------------------------------------------------------------------
// Profiles (AdsPower passthrough — see src/adspower_mcp/adspower/schemas.py)
// ---------------------------------------------------------------------------

export interface AdsPowerUserProxyConfig {
  proxy_host?: string | null;
  proxy_port?: string | number | null;
  proxy_type?: string | null;
  proxy_user?: string | null;
  proxy_password?: string | null;
  [extra: string]: unknown;
}

export interface AdsPowerProfile {
  user_id: string;
  name: string | null;
  group_id: string | null;
  group_name: string | null;
  serial_number: string | null;
  created_time: string | null;
  ip: string | null;
  ip_country: string | null;
  user_proxy_config: AdsPowerUserProxyConfig | null;
  [extra: string]: unknown;
}

/** Result of `POST /api/profiles/sync`. */
export interface SyncProfilesResult {
  created: Array<{
    proxy_id: string;
    name: string | null;
    user_id: string;
  }>;
  skipped: Array<{
    proxy_id: string;
    name: string | null;
    user_id: string;
  }>;
}

/** Result of `POST /api/profiles/{user_id}/open`. */
export interface OpenProfileResult {
  ws: { puppeteer?: string; selenium?: string } & Extras;
  debug_port: string | null;
  webdriver: string | null;
  cdp_endpoint: string | null;
  [extra: string]: unknown;
}

// ---------------------------------------------------------------------------
// Runs (orchestrator state — see src/adspower_mcp/orchestrator/state.py)
// ---------------------------------------------------------------------------

export interface CreatedAccount {
  profile_id: string;
  profile_name: string;
  proxy_id: string;
  email: string;
  password: string;
  username: string | null;
  created_at: string;
}

export interface AccountResult {
  proxy_id: string;
  profile_id: string | null;
  profile_name: string;
  status: AccountStatus;
  error: string | null;
  ip_before: string | null;
  ip_after: string | null;
  account: CreatedAccount | null;
  screenshots: string[];
}

export interface RunSnapshot {
  run_id: string;
  kind: RunKind;
  status: RunStatus;
  error: string | null;
  /** Unix epoch seconds (float). */
  created_at: number;
  /** Unix epoch seconds (float). */
  updated_at: number;
  results: AccountResult[];
}

/** Body for `POST /api/runs/create`. */
export interface CreateAccountsRequest {
  proxy_ids?: string[] | null;
  name_prefix?: string | null;
  rotate_between?: boolean | null;
  birth_year?: number | null;
  /**
   * Hard cap on concurrent signups inside the FastAPI orchestrator. The
   * N-selector dialog sends max_parallel=N so the backend attempts to run all
   * N signups in parallel, still bounded by its own
   * `settings.max_parallel_signups`. See backend/routes/runs.CreateRunBody.
   */
  max_parallel?: number | null;
}

/** Body for `POST /api/runs/warmup`. */
export interface WarmupAccountsRequest {
  profile_ids?: string[] | null;
  rotate_between?: boolean | null;
}

/** 202 response from `POST /api/runs/create` and `POST /api/runs/warmup`. */
export interface RunCreatedResponse {
  run_id: string;
}

// ---------------------------------------------------------------------------
// Meta (health + AdsPower reachability)
// ---------------------------------------------------------------------------

export interface HealthResponse {
  ok: boolean;
  version: string;
  adspower_reachable: boolean;
  [extra: string]: unknown;
}

export interface AdsPowerStatusResponse {
  reachable: boolean;
  latency_ms: number | null;
  error: string | null;
  [extra: string]: unknown;
}

/**
 * Response from `GET /api/meta/capacity` (DESIGN_BRIEF_V2 §5).
 *
 * `proxies` is the local store row count. `profiles` is the AdsPower profile
 * count (0 if AdsPower is unreachable — capacity is best-effort informational
 * data, never a 5xx). `suggested_concurrency` is the friendly upper bound the
 * N-accounts selector surfaces; the hard concurrency cap lives in backend
 * settings.
 */
export interface CapacityResponse {
  proxies: number;
  profiles: number;
  suggested_concurrency: number;
  [extra: string]: unknown;
}

// ---------------------------------------------------------------------------
// Streams — payloads carried on SSE channels
// ---------------------------------------------------------------------------

export interface LogLinePayload {
  ts: number;
  level: string;
  logger: string;
  message: string;
  [extra: string]: unknown;
}
