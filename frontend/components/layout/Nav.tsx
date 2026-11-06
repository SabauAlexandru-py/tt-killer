"use client";

/**
 * Nav — collapsible left sidebar (240px → 56px).
 *
 * Sections, in order (DESIGN_SPEC § Layout + § Frontend routes):
 *   Dashboard, Proxies, Profiles, Runs, Logs, Settings
 *
 * V2 chrome: active item gets an LED dot on its left edge (replacing the old
 * 2px --accent bar). The LED is:
 *   - "steady" (success) on the current route,
 *   - "slow-pulse" (warning amber) on items that have in-flight activity
 *     (Proxies with any rotation/update mutation in progress, Runs with a
 *     run in `running` status).
 *   - hidden on idle non-active items to keep the sidebar quiet.
 *
 * Reduced-motion falls back to steady LEDs — handled globally in
 * `app/globals-v2.css` under `@media (prefers-reduced-motion: reduce)`.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Globe,
  LayoutDashboard,
  ScrollText,
  Settings,
  User,
  type LucideIcon,
} from "lucide-react";
import { listRuns } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { RunSnapshot } from "../../lib/types";
import {
  NAV_WIDTH_COLLAPSED,
  NAV_WIDTH_EXPANDED,
  useNavState,
} from "../../lib/ui-store";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Also match sub-routes (e.g. /runs/[id] → Runs active). */
  matchPrefix?: boolean;
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Proxies", href: "/proxies", icon: Globe, matchPrefix: true },
  { label: "Profiles", href: "/profiles", icon: User, matchPrefix: true },
  { label: "Runs", href: "/runs", icon: Activity, matchPrefix: true },
  { label: "Logs", href: "/logs", icon: ScrollText, matchPrefix: true },
  { label: "Settings", href: "/settings", icon: Settings, matchPrefix: true },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  if (item.matchPrefix) {
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  return pathname === item.href;
}

/**
 * Detects which nav items should slow-pulse because backend work is happening.
 *
 * - Runs: any snapshot with `status === "running"` from the shared runs list
 *   cache. We don't open a new network subscription here — we piggy-back on
 *   TanStack Query's cache, so this hook is near-free when the list hasn't
 *   been loaded yet (returns `false`).
 * - Proxies: `useIsMutating()` is intentionally broad — rotations, deletes,
 *   and inline updates all share one "writing" signal. Precise rotation
 *   gating would need a `mutationKey` on the ProxyList mutation, which is
 *   outside this component's scope. The slow-pulse semantic covers all of
 *   these just as well.
 */
function useNavActivity(): { proxiesBusy: boolean; runsBusy: boolean } {
  // Read the current list straight from cache. `enabled: false` here would
  // disable background refetch; we leave it on so the pulse stays accurate
  // when the user is actually on another page but a run is live.
  const runsQuery = useQuery<RunSnapshot[]>({
    queryKey: queryKeys.runs.list(),
    queryFn: ({ signal }) => listRuns(signal),
    // Low-touch polling — we only need coarse liveness for the LED.
    refetchInterval: 5000,
    refetchOnWindowFocus: false,
    // Don't retry forever if the backend is down; the TopBar LED handles
    // disconnection visually.
    retry: 1,
    staleTime: 2000,
  });

  const runsBusy = useMemo(() => {
    const runs = runsQuery.data;
    if (!Array.isArray(runs)) return false;
    return runs.some((r) => r.status === "running");
  }, [runsQuery.data]);

  // `useIsMutating()` returns the count of in-flight mutations across the
  // app. Any > 0 means some backend write is happening — the Proxies tab is
  // where the user triggers rotations, so we surface it there.
  const mutatingCount = useIsMutating();
  const proxiesBusy = mutatingCount > 0;

  return { proxiesBusy, runsBusy };
}

/**
 * Chooses the LED semantic class for a given nav item.
 *   - active + no activity → "success" (steady emerald)
 *   - active + activity    → "running" (pulsing emerald — the item itself is live)
 *   - inactive + activity  → "warning" (amber slow-pulse)
 *   - inactive + idle      → null (no LED rendered)
 */
function ledClassFor(
  item: NavItem,
  active: boolean,
  busy: { proxiesBusy: boolean; runsBusy: boolean },
): string | null {
  const itemBusy =
    (item.href === "/proxies" && busy.proxiesBusy) ||
    (item.href === "/runs" && busy.runsBusy);

  if (active && itemBusy) return "led led--running";
  if (active) return "led led--success";
  if (itemBusy) return "led led--warning";
  return null;
}

export function Nav() {
  const pathname = usePathname() ?? "/";
  const { navCollapsed, toggleNav } = useNavState();
  const width = navCollapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH_EXPANDED;
  const activity = useNavActivity();

  return (
    <aside
      aria-label="Primary navigation"
      style={{
        width: `${width}px`,
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border)",
        transition: "width var(--dur-normal) var(--ease-out)",
      }}
      className="shrink-0 flex flex-col h-screen sticky top-0"
    >
      {/* Brand / app mark */}
      <div
        className="flex items-center gap-3 px-4"
        style={{
          height: "56px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          aria-hidden
          className="shrink-0"
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "var(--radius-sm)",
            background: "var(--accent-bg)",
            border: "1px solid var(--accent-border)",
          }}
        />
        {!navCollapsed && (
          <div className="flex flex-col leading-tight overflow-hidden">
            <span
              className="truncate"
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              adspower-mcp
            </span>
            <span
              className="truncate"
              style={{
                fontSize: "11px",
                color: "var(--text-muted)",
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              }}
            >
              Mission Control
            </span>
          </div>
        )}
      </div>

      {/* Nav items */}
      <nav aria-label="Sections" className="flex-1 overflow-y-auto py-3">
        <ul className="flex flex-col gap-1 px-2 list-none m-0 p-0">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            const ledClass = ledClassFor(item, active, activity);
            const ledTitle = ledClass?.includes("warning")
              ? `${item.label} — activity in progress`
              : ledClass?.includes("running")
              ? `${item.label} — live`
              : ledClass
              ? `${item.label} — current`
              : undefined;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={navCollapsed ? item.label : ledTitle}
                  className="group relative flex items-center gap-3 outline-none"
                  style={{
                    height: "36px",
                    paddingLeft: "18px",
                    paddingRight: "12px",
                    borderRadius: "var(--radius)",
                    color: active
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                    background: active ? "var(--accent-bg)" : "transparent",
                    border: `1px solid ${
                      active ? "var(--accent-border)" : "transparent"
                    }`,
                    textDecoration: "none",
                    transition:
                      "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--text-secondary)";
                    }
                  }}
                >
                  {/* Left-edge LED — replaces the old 2px accent bar.
                      Positioned slightly inside the left padding so the 10px
                      lens sits visually flush with the item's left edge. */}
                  {ledClass && (
                    <span
                      aria-hidden
                      className={ledClass}
                      style={{
                        position: "absolute",
                        left: "4px",
                        top: "50%",
                        transform: "translateY(-50%)",
                      }}
                    />
                  )}
                  <Icon
                    size={16}
                    strokeWidth={1.75}
                    aria-hidden
                    className="shrink-0"
                    style={{
                      color: active ? "var(--accent)" : "currentColor",
                    }}
                  />
                  {!navCollapsed && (
                    <span
                      className="truncate"
                      style={{
                        fontSize: "13px",
                        fontWeight: active ? 600 : 500,
                      }}
                    >
                      {item.label}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Collapse toggle at the bottom */}
      <div
        style={{
          padding: "8px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <button
          type="button"
          onClick={toggleNav}
          aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!navCollapsed}
          title={navCollapsed ? "Expand" : "Collapse"}
          className="flex items-center gap-3 w-full outline-none"
          style={{
            height: "36px",
            paddingLeft: "12px",
            paddingRight: "12px",
            borderRadius: "var(--radius)",
            border: "1px solid transparent",
            background: "transparent",
            color: "var(--text-secondary)",
            cursor: "pointer",
            transition:
              "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--bg-hover)";
            e.currentTarget.style.color = "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--text-secondary)";
          }}
        >
          {navCollapsed ? (
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden />
          ) : (
            <ChevronLeft size={16} strokeWidth={1.75} aria-hidden />
          )}
          {!navCollapsed && (
            <span style={{ fontSize: "13px", fontWeight: 500 }}>Collapse</span>
          )}
        </button>
      </div>
    </aside>
  );
}
