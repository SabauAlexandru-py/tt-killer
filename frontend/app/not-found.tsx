import Link from "next/link";

export default function NotFound() {
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
          color: "var(--text-muted)",
        }}
      >
        404 · route not found
      </div>
      <h1
        style={{
          margin: 0,
          fontSize: "20px",
          fontWeight: 600,
          lineHeight: 1.2,
        }}
      >
        Nothing wired at this path
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: "13px",
          color: "var(--text-secondary)",
        }}
      >
        Check the URL or jump back to the console.
      </p>
      <Link
        href="/"
        style={{
          marginTop: "8px",
          padding: "10px 16px",
          fontSize: "13px",
          fontWeight: 500,
          color: "var(--accent)",
          background: "var(--accent-bg)",
          border: "1px solid var(--accent-border)",
          borderRadius: "var(--radius)",
          textDecoration: "none",
        }}
      >
        Back to dashboard
      </Link>
    </main>
  );
}
