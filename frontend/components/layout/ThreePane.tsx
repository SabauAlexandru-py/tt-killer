"use client";

/**
 * ThreePane — the locked three-pane shell.
 *
 *   ┌────────┬────────────────────────────┬──────────┐
 *   │  Nav   │   Center (fluid)           │ Inspector│
 *   │ 240/56 │   TopBar + children         │   360    │
 *   └────────┴────────────────────────────┴──────────┘
 *
 * - Left Nav width is driven by the UI store (navCollapsed).
 * - Right Inspector width is 360px when store.inspector !== null, else 0.
 * - Width transitions use var(--dur-normal) + var(--ease-out).
 * - Center is a `<main>`; this component DOES NOT render a TopBar —
 *   pages compose <TopBar /> and <PageHeader /> inside `children` so
 *   each route can supply its own title and actions.
 *
 * Expects <UIProvider /> higher up in the tree (wired in app/providers.tsx).
 */

import type { ReactNode } from "react";
import { Nav } from "./Nav";
import { Inspector } from "./Inspector";

export interface ThreePaneProps {
  children: ReactNode;
}

export function ThreePane({ children }: ThreePaneProps) {
  return (
    <div
      className="flex min-h-screen w-full"
      style={{
        background: "var(--bg-base)",
        color: "var(--text-primary)",
      }}
    >
      <Nav />
      <main
        className="flex-1 min-w-0 flex flex-col"
        style={{
          background: "var(--bg-base)",
        }}
      >
        {children}
      </main>
      <Inspector />
    </div>
  );
}
