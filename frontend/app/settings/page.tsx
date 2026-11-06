"use client";


export const dynamic = "force-dynamic";
import type { ReactNode } from "react";

/**
 * /settings — Mission Control configuration surface.
 *
 * Composes the ThreePane shell with a TopBar + PageHeader, then stacks
 * four section cards in the center column:
 *
 *   1. Backend URL           → BackendUrlField (writes localStorage,
 *                              rekeys the HealthBadge beside it)
 *   2. API keys              → ApiKeysForm (read-only SadCaptcha key)
 *   3. Run defaults          → DefaultsForm (name_prefix, birth_year,
 *                              rotate_between — localStorage-only)
 *   4. Cloudflare Tunnel     → CloudflareTunnelCard (the deploy recipe
 *                              a Vercel-hosted frontend needs)
 *
 * No URL state on this page — every control is per-browser and
 * persisted through localStorage, so there is nothing to serialize
 * into the pathname. No inspector either (DESIGN_SPEC: the right pane
 * is 0px when nothing is selected).
 *
 * Sections are plain <section> blocks with a label/description header
 * and a surface-coloured body. Using CSS variables everywhere keeps
 * the panel consistent with Dashboard/Proxies/Profiles without a
 * shared Card primitive — a Card wrapper would be pure indirection for
 * a page that lives alone in its route.
 */

import { ThreePane } from "@/components/layout/ThreePane";
import { TopBar } from "@/components/layout/TopBar";
import { PageHeader } from "@/components/layout/PageHeader";
import { BackendUrlField } from "@/components/settings/BackendUrlField";
import { ApiKeysForm } from "@/components/settings/ApiKeysForm";
import { DefaultsForm } from "@/components/settings/DefaultsForm";
import { CloudflareTunnelCard } from "@/components/settings/CloudflareTunnelCard";

interface SectionProps {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}

function Section({ id, title, description, children }: SectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="flex flex-col"
      style={{
        gap: "16px",
        padding: "20px 24px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <header className="flex flex-col" style={{ gap: "4px" }}>
        <h2
          id={headingId}
          style={{
            fontSize: "16px",
            lineHeight: 1.3,
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: 0,
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </h2>
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
      </header>
      <div
        aria-hidden="true"
        style={{
          height: "1px",
          background: "var(--border)",
          margin: 0,
        }}
      />
      {children}
    </section>
  );
}

export default function SettingsPage() {
  return (
    <ThreePane>
      <TopBar title="Settings" />
      <PageHeader
        eyebrow="Mission Control"
        title="Settings"
        description="Point the UI at the right backend, review which keys the agent is carrying, and lock in the defaults every new run should start with."
      />
      <div
        className="flex-1 overflow-y-auto"
        style={{ padding: "24px", background: "var(--bg-base)" }}
      >
        <div
          className="mx-auto flex flex-col"
          style={{
            maxWidth: "880px",
            gap: "20px",
          }}
        >
          <Section
            id="section-backend"
            title="Backend connection"
            description="The frontend fetches everything through this origin. Save a new URL to swap in a Cloudflare Tunnel or a remote dev box."
          >
            <BackendUrlField />
          </Section>

          <Section
            id="section-keys"
            title="API keys"
            description="Secrets the agent loaded at startup. Change them in the backend .env and restart — the UI never writes keys."
          >
            <ApiKeysForm />
          </Section>

          <Section
            id="section-defaults"
            title="Run defaults"
            description="Prefilled into the Create accounts dialog. Scoped to this browser profile — nothing is sent to the backend until you kick off a run."
          >
            <DefaultsForm />
          </Section>

          <Section
            id="section-tunnel"
            title="Deploying from Vercel"
            description="Hosting the frontend remotely? The backend has to stay on the operator's machine with AdsPower — bridge the gap with a Cloudflare Tunnel."
          >
            <CloudflareTunnelCard />
          </Section>
        </div>
      </div>
    </ThreePane>
  );
}
