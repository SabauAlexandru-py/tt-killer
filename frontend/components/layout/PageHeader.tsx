"use client";

/**
 * PageHeader — sits inside the center column, below the TopBar.
 *
 *   - Title       : heading-lg (20px / 1.2 / 600).
 *   - Description : text-muted body.
 *   - Actions     : right-aligned slot (primary CTA + secondary buttons).
 *   - Eyebrow     : optional small all-caps label above the title
 *                   (label scale from DESIGN_SPEC § Typography).
 */

import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: PageHeaderProps) {
  return (
    <section
      aria-labelledby="page-header-title"
      className="flex items-start justify-between"
      style={{
        paddingTop: "24px",
        paddingBottom: "20px",
        paddingLeft: "20px",
        paddingRight: "20px",
        gap: "24px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="flex flex-col min-w-0" style={{ gap: "6px", flex: 1 }}>
        {eyebrow && (
          <span
            style={{
              fontSize: "12px",
              lineHeight: 1.4,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              fontWeight: 500,
            }}
          >
            {eyebrow}
          </span>
        )}
        <h1
          id="page-header-title"
          className="truncate"
          style={{
            fontSize: "20px",
            lineHeight: 1.2,
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h1>
        {description && (
          <p
            style={{
              fontSize: "13px",
              lineHeight: 1.5,
              color: "var(--text-secondary)",
              margin: 0,
              maxWidth: "72ch",
            }}
          >
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div
          className="flex items-center"
          style={{ gap: "8px", flexShrink: 0 }}
        >
          {actions}
        </div>
      )}
    </section>
  );
}
