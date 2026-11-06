"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import clsx from "clsx";

// Mnemonic Kbd pill. Multi-token like "G P" shows two side-by-side.
function Kbd({ keys }: { keys: string }) {
  const tokens = keys.split(" ").filter(Boolean);
  return (
    <span className="flex items-center gap-1">
      {tokens.map((k, i) => (
        <kbd
          key={`${k}-${i}`}
          className="inline-flex min-w-[20px] items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono, ui-monospace)",
            borderRadius: "var(--radius-sm, 4px)",
          }}
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

// Lightweight backend URL resolver — matches the Settings page contract.
function getBackendUrl(): string {
  if (typeof window === "undefined") return "http://localhost:8080";
  try {
    return (
      window.localStorage.getItem("adspower-backend-url") ??
      "http://localhost:8080"
    );
  } catch {
    return "http://localhost:8080";
  }
}

async function postJson(path: string, body: unknown = {}): Promise<unknown> {
  const url = `${getBackendUrl().replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  return res.json().catch(() => ({}));
}

type ActionItem = {
  id: string;
  label: string;
  hint: string;
  keys: string;
  group: "Actions" | "Navigate";
  icon?: ReactNode;
  run: () => void | Promise<void>;
};

export interface CommandPaletteProps {
  /** Controlled open state. Leave undefined to let the component own it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const qc = useQueryClient();

  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? !!open : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const toggle = useCallback(() => setOpen(!isOpen), [isOpen, setOpen]);

  // Cmd+K / Ctrl+K toggle. Esc closes (cmdk handles ESC inside its own input).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isK = e.key?.toLowerCase() === "k";
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  // Mutations for the three action commands.
  const createAccounts = useMutation({
    mutationFn: () => postJson("/api/runs/create", {}),
    onSuccess: () => {
      toast.success("Create-accounts run started");
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (err: Error) => toast.error(`Create failed — ${err.message}`),
  });

  const warmupAccounts = useMutation({
    mutationFn: () => postJson("/api/runs/warmup", {}),
    onSuccess: () => {
      toast.success("Warmup run started");
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (err: Error) => toast.error(`Warmup failed — ${err.message}`),
  });

  const rotateAllProxies = useMutation({
    mutationFn: async () => {
      // Pull proxy list, then rotate each. Backend doesn't expose a bulk endpoint.
      const listUrl = `${getBackendUrl().replace(/\/$/, "")}/api/proxies`;
      const listRes = await fetch(listUrl);
      if (!listRes.ok) throw new Error(`${listRes.status} loading proxies`);
      const proxies = (await listRes.json()) as Array<{ id: string }>;
      if (!Array.isArray(proxies) || proxies.length === 0) {
        throw new Error("No proxies configured");
      }
      const results = await Promise.allSettled(
        proxies.map((p) => postJson(`/api/proxies/${p.id}/rotate`)),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: proxies.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      if (failed === 0) toast.success(`Rotated ${total} proxies`);
      else toast.warning(`Rotated ${total - failed}/${total} proxies (${failed} failed)`);
      qc.invalidateQueries({ queryKey: ["proxies"] });
    },
    onError: (err: Error) => toast.error(`Rotate failed — ${err.message}`),
  });

  const items: ActionItem[] = useMemo(
    () => [
      {
        id: "create-accounts",
        label: "Create accounts",
        hint: "Start a new signup run across stored proxies",
        keys: "C",
        group: "Actions",
        run: () => createAccounts.mutate(),
      },
      {
        id: "warmup-accounts",
        label: "Warm up accounts",
        hint: "Launch warmup browsing for existing profiles",
        keys: "W",
        group: "Actions",
        run: () => warmupAccounts.mutate(),
      },
      {
        id: "rotate-all-proxies",
        label: "Rotate all proxies",
        hint: "Hit every proxy's rotation URL",
        keys: "R",
        group: "Actions",
        run: () => rotateAllProxies.mutate(),
      },
      {
        id: "go-proxies",
        label: "Go to Proxies",
        hint: "/proxies",
        keys: "G P",
        group: "Navigate",
        run: () => router.push("/proxies"),
      },
      {
        id: "go-profiles",
        label: "Go to Profiles",
        hint: "/profiles",
        keys: "G F",
        group: "Navigate",
        run: () => router.push("/profiles"),
      },
      {
        id: "go-runs",
        label: "Go to Runs",
        hint: "/runs",
        keys: "G R",
        group: "Navigate",
        run: () => router.push("/runs"),
      },
      {
        id: "go-settings",
        label: "Go to Settings",
        hint: "/settings",
        keys: "G S",
        group: "Navigate",
        run: () => router.push("/settings"),
      },
    ],
    [router, createAccounts, warmupAccounts, rotateAllProxies],
  );

  const runItem = useCallback(
    (item: ActionItem) => {
      setOpen(false);
      void Promise.resolve(item.run()).catch(() => {
        /* mutation callbacks already toast */
      });
    },
    [setOpen],
  );

  if (!isOpen) return null;

  const groups: Array<{ name: ActionItem["group"]; items: ActionItem[] }> = [
    { name: "Actions", items: items.filter((i) => i.group === "Actions") },
    { name: "Navigate", items: items.filter((i) => i.group === "Navigate") },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      role="presentation"
      onClick={(e) => {
        // Backdrop click closes.
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div
        className={clsx(
          "relative mx-4 w-full max-w-xl overflow-hidden",
          "animate-[palette-in_180ms_cubic-bezier(0.16,1,0.3,1)]",
        )}
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg, 8px)",
          boxShadow:
            "0 24px 64px -16px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.4)",
          color: "var(--text-primary)",
        }}
      >
        <Command
          label="Command Palette"
          loop
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
          }}
        >
          <div
            className="flex items-center gap-3 px-4"
            style={{
              height: 48,
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span
              aria-hidden="true"
              className="text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              {/* simple inline caret-prompt glyph */}
              {">"}
            </span>
            <Command.Input
              autoFocus
              placeholder="Type a command or search…"
              className="w-full bg-transparent text-[13px] outline-none placeholder:opacity-60"
              style={{
                color: "var(--text-primary)",
                fontFamily: "var(--font-sans, inherit)",
              }}
            />
            <Kbd keys="Esc" />
          </div>

          <Command.List
            className="max-h-[360px] overflow-y-auto py-2"
            style={{ scrollbarWidth: "thin" }}
          >
            <Command.Empty
              className="px-4 py-6 text-center text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              No matching commands.
            </Command.Empty>

            {groups.map((group) => (
              <Command.Group
                key={group.name}
                heading={group.name}
                className="px-2 pb-2"
              >
                <div
                  className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-[0.08em]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {group.name}
                </div>
                {group.items.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={`${item.label} ${item.hint}`}
                    onSelect={() => runItem(item)}
                    className="group flex cursor-pointer items-center justify-between gap-3 rounded-[6px] px-3 text-[13px]"
                    style={{
                      height: 36,
                      color: "var(--text-primary)",
                    }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{item.label}</span>
                      <span
                        className="truncate text-[11px]"
                        style={{
                          color: "var(--text-muted)",
                          fontFamily:
                            item.group === "Navigate"
                              ? "var(--font-mono, ui-monospace)"
                              : "inherit",
                        }}
                      >
                        {item.hint}
                      </span>
                    </span>
                    <Kbd keys={item.keys} />
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>

          <div
            className="flex items-center justify-between px-4 text-[11px]"
            style={{
              height: 32,
              borderTop: "1px solid var(--border)",
              color: "var(--text-muted)",
            }}
          >
            <span>Mission Control · Command Palette</span>
            <span className="flex items-center gap-2">
              <Kbd keys="⌘ K" />
              <span>toggle</span>
            </span>
          </div>
        </Command>

        <style jsx global>{`
          @keyframes palette-in {
            from {
              opacity: 0;
              transform: translateY(-4px) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          [cmdk-item][data-selected="true"] {
            background: var(--bg-hover);
          }
          [cmdk-item][data-selected="true"] kbd {
            border-color: var(--accent-border);
            color: var(--text-primary);
          }
        `}</style>
      </div>
    </div>
  );
}

export default CommandPalette;
