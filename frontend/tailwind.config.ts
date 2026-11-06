import type { Config } from "tailwindcss";

/**
 * Mission Control token bridge — every color/font/radius/duration is a CSS var
 * driven by globals.css. Do NOT hardcode hex or Tailwind palette colors in
 * components; reach for bg-base / text-primary / border / accent / warn / error
 * / info so the locked OKLCH tokens from the spec stay authoritative.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        base: "var(--bg-base)",
        surface: "var(--bg-surface)",
        raised: "var(--bg-raised)",
        hover: "var(--bg-hover)",

        // Borders
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        "border-focus": "var(--border-focus)",

        // Text
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",

        // Semantic (one accent + warn/error/info)
        accent: "var(--accent)",
        "accent-bg": "var(--accent-bg)",
        "accent-border": "var(--accent-border)",

        warn: "var(--warn)",
        "warn-bg": "var(--warn-bg)",
        "warn-border": "var(--warn-border)",

        error: "var(--error)",
        "error-bg": "var(--error-bg)",
        "error-border": "var(--error-border)",

        info: "var(--info)",
        "info-bg": "var(--info-bg)",
        "info-border": "var(--info-border)",
      },

      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },

      fontSize: {
        // Named to match the spec typography scale
        body: ["13px", { lineHeight: "1.5" }],
        label: ["12px", { lineHeight: "1.4", letterSpacing: "0.02em" }],
        "heading-sm": ["14px", { lineHeight: "1.4", fontWeight: "600" }],
        "heading-md": ["16px", { lineHeight: "1.3", fontWeight: "600" }],
        "heading-lg": ["20px", { lineHeight: "1.2", fontWeight: "600" }],
        display: ["32px", { lineHeight: "1.1", fontWeight: "700" }],
        "mono-data": ["12px", { lineHeight: "1.5" }],
        "mono-log": ["11px", { lineHeight: "1.45" }],
      },

      spacing: {
        // Row heights from the spec
        "row-dense": "32px",
        row: "36px",
        "row-cta": "44px",
        // Layout rails
        nav: "240px",
        "nav-collapsed": "56px",
        inspector: "360px",
        topbar: "48px",
      },

      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
      },

      transitionTimingFunction: {
        out: "var(--ease-out)",
        smooth: "var(--ease-smooth)",
      },

      transitionDuration: {
        fast: "var(--dur-fast)",
        normal: "var(--dur-normal)",
        slow: "var(--dur-slow)",
      },

      keyframes: {
        pulse: {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.3)", opacity: "0" },
        },
      },
      animation: {
        pulse: "pulse 2s cubic-bezier(0.16, 1, 0.3, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
