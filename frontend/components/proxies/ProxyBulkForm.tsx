"use client";

/**
 * ProxyBulkForm — "paste a whole list" companion to ProxyForm.
 *
 * The single-add form is still the right shape for "I'm trying one supplier"
 * flows; this one is for when the operator opens a seller's download, hits
 * select-all + copy, and wants ten accounts' worth of proxies landed in the
 * store with one click.
 *
 * Shape (matches DESIGN_BRIEF_V2 §6):
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  Paste your proxies                          │
 *   │  [ 12-row mono textarea ]                    │
 *   │                                              │
 *   │  ●  Will add 12 proxies · 2 lines skipped    │   ← live preview
 *   │                                              │
 *   │              [ Clear ]  [ Add 12 proxies ]   │
 *   └──────────────────────────────────────────────┘
 *
 * The preview is computed client-side from `parseBulkProxyLines`; the server
 * runs its own authoritative parse and may still reject lines the client
 * accepted (duplicates against existing stored proxies, for example), so
 * the toast quotes the server's `inserted.length` — never the preview count.
 *
 * LED next to the summary follows the brief §2 vocabulary: idle when the
 * textarea is empty, running+pulse when there's at least one valid line,
 * warning when every line was skipped, success+steady for the 600ms right
 * after a server-confirmed insert.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload } from "lucide-react";

import Button from "@/components/ui/Button";
import Textarea from "@/components/ui/Textarea";
import { Led } from "@/components/ui/LED";
import type { LedPattern, LedTone } from "@/components/ui/LED";
import { bulkCreateProxiesByText } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import {
  parseBulkProxyLines,
  summariseParseResult,
  type BulkParseResult,
} from "@/lib/bulk-proxies";

const PLACEHOLDER = [
  "# Paste one proxy per line. Lines starting with # are comments.",
  "# Any of these four formats work:",
  "",
  "185.244.1.14:10013:usr_7fa:p@ss!word       # host:port:user:pass",
  "185.244.1.15:10013                         # host:port",
  "http://usr_7fa:p@ss!word@185.244.1.16:10013  # scheme://user:pass@host:port",
  "socks5://185.244.1.17:1080                 # scheme://host:port",
].join("\n");

export interface ProxyBulkFormProps {
  /** Called after a successful bulk insert so the parent can scroll / focus. */
  onInserted?: (count: number) => void;
}

export function ProxyBulkForm({ onInserted }: ProxyBulkFormProps) {
  const [text, setText] = useState("");
  const [flashSuccess, setFlashSuccess] = useState(false);
  const flashTimerRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  // Parse on every keystroke. The parser is pure and cheap (one pass, no
  // allocations beyond the result arrays), so memoising on `text` alone is
  // enough — we don't need a debounce.
  const result: BulkParseResult = useMemo(
    () => parseBulkProxyLines(text),
    [text],
  );

  const hasValid = result.valid.length > 0;
  const onlySkipped = result.totalLines > 0 && !hasValid;

  const bulkMutation = useMutation({
    mutationFn: (payload: string) =>
      bulkCreateProxiesByText({ text: payload }),
    onSuccess: (res) => {
      const added = res.inserted.length;
      queryClient.invalidateQueries({ queryKey: queryKeys.proxies.all });

      if (added > 0) {
        const skipped = res.skipped.length + res.errors.length;
        const description =
          skipped > 0
            ? `${skipped} ${skipped === 1 ? "line" : "lines"} skipped by the server.`
            : undefined;
        toast.success(`${added} ${added === 1 ? "proxy" : "proxies"} added`, {
          description,
        });

        // Clear only when the server took at least one — otherwise the
        // operator gets to see what the server didn't like and fix it in
        // place. Same logic as the single-add form (which clears only on
        // success).
        setText("");

        // Trigger the `success` LED flash for ~600ms.
        setFlashSuccess(true);
        if (flashTimerRef.current !== null) {
          window.clearTimeout(flashTimerRef.current);
        }
        flashTimerRef.current = window.setTimeout(() => {
          setFlashSuccess(false);
          flashTimerRef.current = null;
        }, 600);

        onInserted?.(added);
      } else {
        toast.error("Nothing added", {
          description:
            res.errors.length > 0
              ? `Every line failed validation (${res.errors.length}).`
              : "Every line was a duplicate of an existing proxy.",
        });
      }
    },
    onError: (err) => {
      toast.error("Bulk import failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  // Clear the flash timer on unmount so a late-firing timer doesn't call
  // setState on an unmounted component.
  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
    };
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (bulkMutation.isPending) return;
    if (!hasValid) {
      toast.error("Nothing to add", {
        description:
          result.totalLines === 0
            ? "Paste at least one proxy line."
            : "Every pasted line failed the client-side check — fix them first.",
      });
      return;
    }
    bulkMutation.mutate(text);
  };

  const handleClear = useCallback(() => {
    setText("");
  }, []);

  // Cmd/Ctrl+Enter to submit — operators live in the textarea.
  const handleTextareaKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!bulkMutation.isPending && hasValid) {
        bulkMutation.mutate(text);
      }
    }
  };

  // LED state follows the parse result:
  //   - just succeeded (<=600ms)  → success + steady
  //   - mutation in flight        → busy + heartbeat (bridge-call feel)
  //   - no text                   → idle + steady
  //   - some valid rows           → running + pulse
  //   - all lines skipped         → warning + fast-blink
  const ledState: { tone: LedTone; pattern: LedPattern; label: string } =
    flashSuccess
      ? { tone: "success", pattern: "steady", label: "Import succeeded" }
      : bulkMutation.isPending
      ? { tone: "busy", pattern: "heartbeat", label: "Importing proxies" }
      : result.totalLines === 0
      ? { tone: "idle", pattern: "steady", label: "Waiting for input" }
      : onlySkipped
      ? {
          tone: "warning",
          pattern: "fast-blink",
          label: "Every line was rejected",
        }
      : { tone: "running", pattern: "pulse", label: "Ready to import" };

  const summary = summariseParseResult(result);

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Bulk add proxies"
      className="rounded-md border"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-surface)",
        padding: "16px",
      }}
    >
      <div
        className="flex flex-col"
        style={{ gap: "10px" }}
      >
        <label
          htmlFor="proxy-bulk-text"
          style={{
            fontSize: "11px",
            lineHeight: 1.4,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
            fontWeight: 600,
          }}
        >
          Paste your proxies
        </label>

        <Textarea
          id="proxy-bulk-text"
          name="bulk-text"
          variant="mono"
          rows={12}
          minRows={12}
          placeholder={PLACEHOLDER}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleTextareaKey}
          disabled={bulkMutation.isPending}
          aria-describedby="proxy-bulk-summary"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          style={{
            // Slightly tighter line-height than the default — mono lists
            // read faster when they stack dense.
            lineHeight: 1.45,
          }}
        />

        <div
          id="proxy-bulk-summary"
          role="status"
          aria-live="polite"
          className="flex items-center"
          style={{
            gap: "10px",
            fontSize: "12px",
            color: onlySkipped
              ? "var(--warn)"
              : hasValid
              ? "var(--text-secondary)"
              : "var(--text-muted)",
            minHeight: "18px",
          }}
        >
          <Led
            tone={ledState.tone}
            pattern={ledState.pattern}
            size="sm"
            label={ledState.label}
          />
          <span>
            {summary}
            {result.skipped.length > 0 && hasValid ? (
              <span
                style={{
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  marginLeft: "8px",
                }}
              >
                (first bad line: {result.skipped[0]!.lineNumber})
              </span>
            ) : null}
          </span>
        </div>
      </div>

      <div
        className="flex items-center justify-end"
        style={{ gap: "8px", marginTop: "16px" }}
      >
        <Button
          type="button"
          variant="ghost"
          onClick={handleClear}
          disabled={bulkMutation.isPending || text.length === 0}
        >
          Clear
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={bulkMutation.isPending}
          disabled={!hasValid || bulkMutation.isPending}
          icon={!bulkMutation.isPending ? <Upload size={14} /> : undefined}
        >
          {hasValid
            ? `Add ${result.valid.length} ${
                result.valid.length === 1 ? "proxy" : "proxies"
              }`
            : "Add proxies"}
        </Button>
      </div>
    </form>
  );
}

export default ProxyBulkForm;
