"use client";

/**
 * Inspector — right-side detail pane.
 *
 *   - 360px wide when content is set in the UI store.
 *   - Slides in from the right with var(--dur-normal) + var(--ease-out).
 *   - Header = title + close button.
 *   - Body = ReactNode supplied by the caller via openInspector().
 *   - Never a modal: keeps the center pane interactive.
 *
 * Content lives in lib/ui-store (InspectorContent).
 */

import { X } from "lucide-react";
import { INSPECTOR_WIDTH, useInspectorState } from "../../lib/ui-store";

export function Inspector() {
  const { inspector, closeInspector } = useInspectorState();
  const open = inspector !== null;

  return (
    <aside
      aria-label="Detail inspector"
      aria-hidden={!open}
      role="complementary"
      style={{
        width: open ? `${INSPECTOR_WIDTH}px` : "0px",
        minWidth: open ? `${INSPECTOR_WIDTH}px` : "0px",
        overflow: "hidden",
        background: "var(--bg-surface)",
        borderLeft: open ? "1px solid var(--border)" : "1px solid transparent",
        transition:
          "width var(--dur-normal) var(--ease-out), min-width var(--dur-normal) var(--ease-out), border-color var(--dur-normal) var(--ease-out)",
      }}
      className="shrink-0 flex flex-col h-screen sticky top-0"
    >
      {/* Inner wrapper pinned at full inspector width so content doesn't
          reflow during the width transition. */}
      <div
        style={{
          width: `${INSPECTOR_WIDTH}px`,
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{
            height: "48px",
            paddingLeft: "16px",
            paddingRight: "8px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div className="flex flex-col leading-tight overflow-hidden">
            <span
              style={{
                fontSize: "11px",
                letterSpacing: "0.02em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              Inspector
            </span>
            <span
              className="truncate"
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {inspector?.title ?? ""}
            </span>
          </div>
          <button
            type="button"
            onClick={closeInspector}
            aria-label="Close inspector"
            title="Close (Esc)"
            className="flex items-center justify-center outline-none"
            style={{
              width: "32px",
              height: "32px",
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
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px",
            color: "var(--text-primary)",
            fontSize: "13px",
            lineHeight: 1.5,
          }}
        >
          {inspector?.body ?? null}
        </div>
      </div>
    </aside>
  );
}
