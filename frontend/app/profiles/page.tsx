"use client";


export const dynamic = "force-dynamic";
/**
 * /profiles — Profile explorer route.
 *
 * Layout (DESIGN_SPEC § Frontend routes):
 *   ThreePane  → Nav + Center + Inspector
 *     Center   → TopBar ("Profiles" title + HealthBadge-style breadcrumb)
 *                PageHeader ("Profiles" + description + SyncButton)
 *                ProfileTable (full-bleed inside a 20px padded container)
 *
 * The AdsPower profiles query lives here (not in the table component) so
 * the TopBar can show total count and the EmptyState below can distinguish
 * "no profiles yet" from "backend error".
 */

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Server } from "lucide-react";

import { listProfiles, listProxies } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { AdsPowerProfile, StoredProxy } from "@/lib/types";
import { ThreePane } from "@/components/layout/ThreePane";
import { TopBar } from "@/components/layout/TopBar";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/data";
import Pill from "@/components/ui/Pill";

import { ProfileTable } from "@/components/profiles/ProfileTable";
import { ProfileGrid } from "@/components/profiles/ProfileGrid";
import {
  ViewSwitcher,
  useProfilesView,
} from "@/components/profiles/ViewSwitcher";
import { SyncButton } from "@/components/profiles/SyncButton";

export default function ProfilesPage() {
  const query = useQuery<AdsPowerProfile[], Error>({
    queryKey: queryKeys.profiles.list(),
    queryFn: ({ signal }) => listProfiles(signal),
    // Keep the table fresh while the operator watches multiple warmups —
    // 10s matches the HealthBadge poll cadence and is cheap.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  // Proxies feed the grid card's rotation LED (steady < 15m, slow-pulse
  // otherwise). The table view ignores this, so we gate it on grid view
  // in a later step to avoid an unused fetch when the operator is in table
  // mode — but keep enabled by default so the first grid paint has data.
  const [view, setView] = useProfilesView("grid");
  const proxiesQuery = useQuery<StoredProxy[], Error>({
    queryKey: queryKeys.proxies.list(),
    queryFn: ({ signal }) => listProxies(signal),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    enabled: view === "grid",
  });

  const profiles = query.data ?? [];
  const proxies = proxiesQuery.data ?? [];
  const isLoading = query.isLoading;
  const isError = query.isError;
  const errorMessage = query.error?.message ?? "Backend unreachable.";

  const topbarCount = isLoading
    ? "…"
    : isError
      ? "!"
      : String(profiles.length);

  return (
    <ThreePane>
      <TopBar
        left={
          <div className="flex items-center" style={{ gap: "10px" }}>
            <span
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--text-primary)",
                letterSpacing: "-0.005em",
              }}
            >
              Profiles
            </span>
            <Pill
              tone={isError ? "error" : "default"}
              icon={<Server size={10} strokeWidth={2} aria-hidden />}
            >
              {topbarCount}
            </Pill>
          </div>
        }
        actions={
          <div className="flex items-center" style={{ gap: "8px" }}>
            <ViewSwitcher value={view} onChange={setView} />
            <SyncButton size="sm" />
          </div>
        }
      />

      <PageHeader
        eyebrow="AdsPower"
        title="Profiles"
        description="Browser profiles AdsPower runs for each of your proxies. Click a row for full detail. Sync creates one profile per stored proxy that doesn't have one yet."
        actions={<SyncButton size="default" variant="primary" />}
      />

      <section
        aria-labelledby="profiles-table"
        style={{
          padding: "20px",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        <h2 id="profiles-table" className="sr-only">
          AdsPower profile list
        </h2>

        {isError && <BackendErrorBanner message={errorMessage} />}

        {view === "grid" ? (
          <ProfileGrid
            profiles={profiles}
            proxies={proxies}
            loading={isLoading}
            empty={
              isError ? (
                <EmptyState
                  title="Couldn't load profiles"
                  description={errorMessage}
                  compact
                />
              ) : (
                <EmptyState
                  title="No AdsPower profiles yet"
                  description="Add proxies on the Proxies page, then click Sync from proxies to materialize one AdsPower profile per proxy."
                />
              )
            }
          />
        ) : (
          <ProfileTable
            profiles={profiles}
            loading={isLoading}
            empty={
              isError ? (
                <EmptyState
                  title="Couldn't load profiles"
                  description={errorMessage}
                  compact
                />
              ) : (
                <EmptyState
                  title="No AdsPower profiles yet"
                  description="Add proxies on the Proxies page, then click Sync from proxies to materialize one AdsPower profile per proxy."
                />
              )
            }
          />
        )}
      </section>
    </ThreePane>
  );
}

// ---------------------------------------------------------------------------
// Inline backend-error banner — shown above the table when the fetch fails
// so the operator sees the detail even if a stale cache is still populated.
// ---------------------------------------------------------------------------

function BackendErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "10px 14px",
        borderRadius: "var(--radius)",
        border: "1px solid var(--error-border)",
        background: "var(--error-bg)",
        color: "var(--error)",
      }}
    >
      <AlertTriangle
        size={16}
        strokeWidth={1.75}
        aria-hidden
        style={{ marginTop: "2px", flexShrink: 0 }}
      />
      <div className="flex flex-col" style={{ gap: "2px" }}>
        <span style={{ fontWeight: 600, fontSize: "13px" }}>
          Backend unreachable
        </span>
        <span
          style={{
            fontSize: "12px",
            color: "var(--text-secondary)",
            wordBreak: "break-word",
          }}
        >
          {message}
        </span>
      </div>
    </div>
  );
}
