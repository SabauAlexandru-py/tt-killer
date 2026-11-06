/**
 * Centralised TanStack Query keys.
 *
 * Every call site routes through this file so cache invalidation after a
 * mutation is a one-liner:
 *
 *   await createProxy(payload);
 *   queryClient.invalidateQueries({ queryKey: queryKeys.proxies.all });
 *
 * Why factories instead of raw string tuples?
 *   - Keeps TypeScript narrow on the id, so `queryKeys.runs.detail(id)`
 *     literally can't be called with `undefined`.
 *   - Partial keys (`queryKeys.runs.all`) match every detail cache the
 *     feature owns, so invalidating one key refreshes the list + inspector
 *     + every open detail page at once.
 *   - Changing a key segment (e.g. "proxies" → "proxy-pool") touches
 *     exactly one file.
 *
 * Shape:
 *
 *   ["proxies"]
 *   ["proxies", "detail", id]
 *   ["profiles"]
 *   ["profiles", "detail", userId]
 *   ["runs"]
 *   ["runs", "detail", runId]
 *   ["meta", "health"]
 *   ["meta", "adspower"]
 */

export const queryKeys = {
  proxies: {
    all: ["proxies"] as const,
    list: () => ["proxies", "list"] as const,
    detail: (id: string) => ["proxies", "detail", id] as const,
  },
  profiles: {
    all: ["profiles"] as const,
    list: () => ["profiles", "list"] as const,
    detail: (userId: string) => ["profiles", "detail", userId] as const,
  },
  runs: {
    all: ["runs"] as const,
    list: () => ["runs", "list"] as const,
    detail: (runId: string) => ["runs", "detail", runId] as const,
  },
  meta: {
    all: ["meta"] as const,
    health: () => ["meta", "health"] as const,
    adspower: () => ["meta", "adspower"] as const,
    capacity: () => ["meta", "capacity"] as const,
  },
} as const;

// ---------------------------------------------------------------------------
// Type helpers — handy for typing a QueryFunction<Data, TQueryKey> payload.
// ---------------------------------------------------------------------------

export type ProxyListKey = ReturnType<typeof queryKeys.proxies.list>;
export type ProxyDetailKey = ReturnType<typeof queryKeys.proxies.detail>;

export type ProfileListKey = ReturnType<typeof queryKeys.profiles.list>;
export type ProfileDetailKey = ReturnType<typeof queryKeys.profiles.detail>;

export type RunListKey = ReturnType<typeof queryKeys.runs.list>;
export type RunDetailKey = ReturnType<typeof queryKeys.runs.detail>;

export type HealthKey = ReturnType<typeof queryKeys.meta.health>;
export type AdsPowerStatusKey = ReturnType<typeof queryKeys.meta.adspower>;
