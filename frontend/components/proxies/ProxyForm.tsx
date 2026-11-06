"use client";

/**
 * ProxyForm — inline "add proxy" form rendered above the ProxyList table.
 *
 * Fields (DESIGN_SPEC § Backend endpoints / POST /api/proxies):
 *   name          (required)        — operator-friendly label
 *   host          (required)        — hostname or IP
 *   port          (required, int)   — 1–65535
 *   type          (required)        — http / https / socks5
 *   user          (optional)        — proxy auth username
 *   password      (optional)        — proxy auth password
 *   rotation_url  (optional)        — HTTP endpoint that rotates the IP
 *
 * Submission wraps `api.createProxy` with TanStack Query useMutation,
 * invalidates `queryKeys.proxies.all` on success, and emits a toast.
 *
 * The form stays uncontrolled with React state (no React Hook Form yet —
 * the signup/warmup pages don't need it and leaving a dep out keeps the
 * bundle tight). Each field manages its own string state; `parseInt` guards
 * the port. Client-side validation lives inside `validate()`.
 */

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { createProxy } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { CreateProxyRequest, ProxyType } from "@/lib/types";

const PROXY_TYPE_OPTIONS: Array<{ value: ProxyType; label: string }> = [
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
  { value: "socks5", label: "SOCKS5" },
];

interface FormState {
  name: string;
  host: string;
  port: string;
  type: ProxyType;
  user: string;
  password: string;
  rotation_url: string;
}

const INITIAL_STATE: FormState = {
  name: "",
  host: "",
  port: "",
  type: "http",
  user: "",
  password: "",
  rotation_url: "",
};

type ErrorMap = Partial<Record<keyof FormState, string>>;

function validate(state: FormState): { ok: boolean; errors: ErrorMap; payload?: CreateProxyRequest } {
  const errors: ErrorMap = {};
  const name = state.name.trim();
  const host = state.host.trim();
  const portRaw = state.port.trim();
  const user = state.user.trim();
  const password = state.password; // passwords keep whitespace
  const rotationUrl = state.rotation_url.trim();

  if (!name) errors.name = "Name is required.";
  if (!host) errors.host = "Host is required.";

  let port = NaN;
  if (!portRaw) {
    errors.port = "Port is required.";
  } else if (!/^\d+$/.test(portRaw)) {
    errors.port = "Port must be a whole number.";
  } else {
    port = parseInt(portRaw, 10);
    if (port < 1 || port > 65535) {
      errors.port = "Port must be between 1 and 65535.";
    }
  }

  if (rotationUrl && !/^https?:\/\//i.test(rotationUrl)) {
    errors.rotation_url = "Rotation URL must start with http:// or https://.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors,
    payload: {
      name,
      host,
      port,
      type: state.type,
      user: user || null,
      password: password || null,
      rotation_url: rotationUrl || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Field — label + control + inline error. 12px label, 36px input (spec).
// ---------------------------------------------------------------------------

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  /** Grid column span in units of the 12-col form grid (1–12). */
  span?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
}

function Field({ id, label, hint, error, children, span = 3 }: FieldProps) {
  return (
    <div
      className="flex flex-col"
      style={{
        gap: "6px",
        gridColumn: `span ${span} / span ${span}`,
        minWidth: 0,
      }}
    >
      <label
        htmlFor={id}
        style={{
          fontSize: "11px",
          lineHeight: 1.4,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
          fontWeight: 600,
        }}
      >
        {label}
      </label>
      {children}
      {error ? (
        <span
          role="alert"
          style={{ fontSize: "11px", color: "var(--error)" }}
        >
          {error}
        </span>
      ) : hint ? (
        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProxyForm
// ---------------------------------------------------------------------------

export interface ProxyFormProps {
  /** Called after a successful create, so the page can scroll to the new row. */
  onCreated?: (payload: CreateProxyRequest) => void;
}

export function ProxyForm({ onCreated }: ProxyFormProps) {
  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = useState<ErrorMap>({});
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (payload: CreateProxyRequest) => createProxy(payload),
    onSuccess: (proxy, payload) => {
      toast.success(`Proxy "${proxy.name}" added`, {
        description: `${proxy.host}:${proxy.port} • ${proxy.type.toUpperCase()}`,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies.all });
      setState(INITIAL_STATE);
      setErrors({});
      onCreated?.(payload);
    },
    onError: (err) => {
      toast.error("Couldn’t add proxy", {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const update = (key: keyof FormState, value: string) => {
    setState((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validate(state);
    if (!result.ok || !result.payload) {
      setErrors(result.errors);
      return;
    }
    createMutation.mutate(result.payload);
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Add proxy"
      className="rounded-md border"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-surface)",
        padding: "16px",
      }}
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gap: "12px",
        }}
      >
        <Field
          id="proxy-name"
          label="Name"
          span={3}
          error={errors.name}
          hint="Any label — shown in the table and run logs."
        >
          <Input
            id="proxy-name"
            name="name"
            autoComplete="off"
            placeholder="iPhone 12 · US-West"
            value={state.name}
            onChange={(e) => update("name", e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            disabled={createMutation.isPending}
          />
        </Field>

        <Field
          id="proxy-host"
          label="Host"
          span={3}
          error={errors.host}
        >
          <Input
            id="proxy-host"
            name="host"
            autoComplete="off"
            placeholder="proxy.example.com"
            value={state.host}
            onChange={(e) => update("host", e.target.value)}
            aria-invalid={errors.host ? true : undefined}
            disabled={createMutation.isPending}
            variant="mono"
          />
        </Field>

        <Field
          id="proxy-port"
          label="Port"
          span={2}
          error={errors.port}
        >
          <Input
            id="proxy-port"
            name="port"
            type="number"
            inputMode="numeric"
            min={1}
            max={65535}
            placeholder="8080"
            value={state.port}
            onChange={(e) => update("port", e.target.value)}
            aria-invalid={errors.port ? true : undefined}
            disabled={createMutation.isPending}
            variant="mono"
          />
        </Field>

        <Field id="proxy-type" label="Type" span={2}>
          <Select
            id="proxy-type"
            name="type"
            options={PROXY_TYPE_OPTIONS}
            value={state.type}
            onChange={(e) => update("type", e.target.value as ProxyType)}
            disabled={createMutation.isPending}
          />
        </Field>

        <Field id="proxy-user" label="User" span={2} hint="Optional">
          <Input
            id="proxy-user"
            name="user"
            autoComplete="off"
            placeholder="username"
            value={state.user}
            onChange={(e) => update("user", e.target.value)}
            disabled={createMutation.isPending}
            variant="mono"
          />
        </Field>

        <Field id="proxy-password" label="Password" span={3} hint="Optional">
          <Input
            id="proxy-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={state.password}
            onChange={(e) => update("password", e.target.value)}
            disabled={createMutation.isPending}
          />
        </Field>

        <Field
          id="proxy-rotation-url"
          label="Rotation URL"
          span={9}
          error={errors.rotation_url}
          hint="Optional — hit this URL to force a new IP before each signup."
        >
          <Input
            id="proxy-rotation-url"
            name="rotation_url"
            autoComplete="off"
            placeholder="https://rotate.example.com/token"
            value={state.rotation_url}
            onChange={(e) => update("rotation_url", e.target.value)}
            aria-invalid={errors.rotation_url ? true : undefined}
            disabled={createMutation.isPending}
            variant="mono"
          />
        </Field>
      </div>

      <div
        className="flex items-center justify-end"
        style={{ gap: "8px", marginTop: "16px" }}
      >
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setState(INITIAL_STATE);
            setErrors({});
          }}
          disabled={createMutation.isPending}
        >
          Reset
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={createMutation.isPending}
          icon={!createMutation.isPending ? <Plus size={14} /> : undefined}
        >
          Add proxy
        </Button>
      </div>
    </form>
  );
}

export default ProxyForm;
