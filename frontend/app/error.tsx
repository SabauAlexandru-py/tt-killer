"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to devtools for operator inspection.
    console.error("[adspower-mcp] boundary caught:", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        padding: "32px",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          letterSpacing: "0.02em",
          textTransform: "uppercase",
          color: "var(--error)",
        }}
      >
        Runtime fault
      </div>
      <h1
        style={{
          margin: 0,
          fontSize: "20px",
          fontWeight: 600,
          lineHeight: 1.2,
          color: "var(--text-primary)",
        }}
      >
        Something broke in the console
      </h1>
      <pre
        style={{
          margin: 0,
          maxWidth: "560px",
          padding: "12px 16px",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          lineHeight: 1.5,
          color: "var(--error)",
          background: "var(--error-bg)",
          border: "1px solid var(--error-border)",
          borderRadius: "var(--radius)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {error.message || "Unknown error"}
      </pre>
      {error.digest ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          digest · {error.digest}
        </div>
      ) : null}
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: "8px",
          padding: "10px 16px",
          fontSize: "13px",
          fontWeight: 500,
          color: "var(--text-primary)",
          background: "var(--bg-raised)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius)",
          cursor: "pointer",
          fontFamily: "var(--font-sans)",
        }}
      >
        Retry
      </button>
    </main>
  );
}
