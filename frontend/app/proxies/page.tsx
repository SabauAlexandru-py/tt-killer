"use client";


export const dynamic = "force-dynamic";
/**
 * /proxies — proxy manager route.
 *
 * Shape (DESIGN_SPEC § Frontend routes, extended by DESIGN_BRIEF_V2 §6):
 *   ThreePane
 *     └── PageHeader "Proxies"
 *     └── Center
 *           ├── [Single | Bulk paste] tab bar
 *           ├── ProxyForm            (single-add — Single tab)
 *           │   ─ or ─
 *           │   ProxyBulkForm        (paste a list — Bulk paste tab)
 *           └── ProxyList            (table, always below)
 *
 * The tab bar is a hand-rolled radio group so the bulk form stays mounted
 * in `display: none` state while the operator switches between tabs — that
 * keeps the parse state and whatever they'd pasted so far, matching what
 * AdsPower does. Keyboard: ←/→ moves between tabs when either is focused.
 *
 * Edit flow: ProxyList raises `onEdit(proxy)` → we stash it in local state
 * and (for now) emit a toast; wiring the update form sits with the inline
 * edit-in-place task later. We keep the handle here so ProxyList isn't
 * coupled to a specific side-effect.
 */

import { useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { ThreePane } from "@/components/layout/ThreePane";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProxyBulkForm } from "@/components/proxies/ProxyBulkForm";
import { ProxyForm } from "@/components/proxies/ProxyForm";
import { ProxyList } from "@/components/proxies/ProxyList";
import type { StoredProxy } from "@/lib/types";

type AddMode = "single" | "bulk";

const TAB_ORDER: AddMode[] = ["single", "bulk"];

const TAB_LABEL: Record<AddMode, string> = {
  single: "Single",
  bulk: "Bulk paste",
};

export default function ProxiesPage() {
  const [mode, setMode] = useState<AddMode>("single");

  // Placeholder for the forthcoming inline edit panel. We keep state here
  // so other components on the page can react (e.g. scrolling to the row
  // being edited) without ProxyList owning the lifecycle.
  const [, setEditing] = useState<StoredProxy | null>(null);

  const handleEdit = (proxy: StoredProxy) => {
    setEditing(proxy);
    toast.info(`Editing "${proxy.name}" isn’t wired yet.`, {
      description: "Inline edit lands with the next pass — rotate and delete work.",
    });
  };

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const idx = TAB_ORDER.indexOf(mode);
    if (idx === -1) return;
    const nextIdx =
      event.key === "ArrowRight"
        ? (idx + 1) % TAB_ORDER.length
        : (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    setMode(TAB_ORDER[nextIdx]!);
  };

  return (
    <ThreePane>
      <PageHeader
        title="Proxies"
        eyebrow="Pool"
        description="Stored proxies used for TikTok signups and warmups. Rotation URL is optional — when set, the orchestrator fires it before each session."
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          padding: "20px",
          minHeight: 0,
          flex: 1,
        }}
      >
        <div
          className="flex items-center"
          role="tablist"
          aria-label="Add proxies mode"
          style={{
            gap: "4px",
            padding: "4px",
            background: "var(--bg-raised)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            alignSelf: "flex-start",
          }}
        >
          {TAB_ORDER.map((m) => {
            const isActive = m === mode;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                id={`proxy-add-tab-${m}`}
                aria-selected={isActive}
                aria-controls={`proxy-add-panel-${m}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setMode(m)}
                onKeyDown={handleTabKey}
                style={{
                  height: "28px",
                  padding: "0 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  borderRadius: "calc(var(--radius) - 2px)",
                  border: "1px solid transparent",
                  background: isActive
                    ? "var(--accent-bg)"
                    : "transparent",
                  color: isActive
                    ? "var(--accent)"
                    : "var(--text-secondary)",
                  borderColor: isActive
                    ? "var(--accent-border)"
                    : "transparent",
                  cursor: "pointer",
                  transition:
                    "background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)",
                }}
              >
                {TAB_LABEL[m]}
              </button>
            );
          })}
        </div>

        {/* Both panels stay mounted; `display: none` keeps the bulk-paste
            buffer intact while the operator flips tabs. */}
        <div
          role="tabpanel"
          id="proxy-add-panel-single"
          aria-labelledby="proxy-add-tab-single"
          hidden={mode !== "single"}
          style={{ display: mode === "single" ? "block" : "none" }}
        >
          <ProxyForm />
        </div>
        <div
          role="tabpanel"
          id="proxy-add-panel-bulk"
          aria-labelledby="proxy-add-tab-bulk"
          hidden={mode !== "bulk"}
          style={{ display: mode === "bulk" ? "block" : "none" }}
        >
          <ProxyBulkForm />
        </div>

        <ProxyList onEdit={handleEdit} />
      </div>
    </ThreePane>
  );
}
