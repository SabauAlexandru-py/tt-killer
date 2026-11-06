"use client";

/**
 * ScreenshotThumb — 48×80 lazy-loaded screenshot thumb with hover-expand.
 *
 *   - Thumb: 48×80, object-cover, subtle --border, --radius-sm.
 *     Skeleton shimmer until the <img> fires `onLoad`.
 *   - Preview: 300×500 floating card via `createPortal` into document.body.
 *     Opens on mouseenter / focus, closes on mouseleave / blur / Escape.
 *     Positioned relative to the thumb's bounding rect, clamped inside the
 *     viewport with an 8px margin.
 *   - 10px mono tabular timestamp bottom-right on both the thumb and the
 *     preview overlay.
 *   - Clicking the thumb opens the full image in a new tab, so operators can
 *     drag a screenshot into a report without leaving the terminal view.
 *
 * Parent is responsible for resolving the `src` to a full backend URL (via
 * `buildApiUrl`) — the component stays transport-agnostic.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";

const THUMB_W = 48;
const THUMB_H = 80;
const PREVIEW_W = 300;
const PREVIEW_H = 500;
const MARGIN = 8;

export interface ScreenshotThumbProps {
  /** Fully-resolved image URL (parent prepends backend origin). */
  src: string;
  /** Alt text for a11y. */
  alt?: string;
  /** Optional caption shown under the preview image. */
  caption?: string;
  /** Unix epoch seconds for the bottom-right timestamp overlay. */
  timestamp?: number | null;
  /** Extra class names on the thumb wrapper. */
  className?: string;
}

export function ScreenshotThumb({
  src,
  alt = "Run screenshot",
  caption,
  timestamp = null,
  className,
}: ScreenshotThumbProps) {
  const thumbRef = useRef<HTMLButtonElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [portalReady, setPortalReady] = useState(false);

  // Portals need `document` — only true after mount.
  useEffect(() => {
    setPortalReady(true);
  }, []);

  const computeCoords = useCallback(() => {
    const el = thumbRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Prefer right-of-thumb; flip to left if it would overflow the viewport.
    let left = rect.right + MARGIN;
    if (left + PREVIEW_W > window.innerWidth - MARGIN) {
      left = rect.left - PREVIEW_W - MARGIN;
    }
    left = Math.max(MARGIN, left);
    let top = rect.top + rect.height / 2 - PREVIEW_H / 2;
    top = Math.max(
      MARGIN,
      Math.min(top, window.innerHeight - PREVIEW_H - MARGIN),
    );
    setCoords({ top, left });
  }, []);

  // Recompute on open + on viewport changes while open.
  useLayoutEffect(() => {
    if (!hover) return;
    computeCoords();
    const onResize = () => computeCoords();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [hover, computeCoords]);

  const onEnter = () => setHover(true);
  const onLeave = () => setHover(false);
  const onKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && hover) {
      event.stopPropagation();
      setHover(false);
    }
  };

  const onClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    // Let shift/meta clicks keep default behavior for power users.
    if (event.shiftKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    window.open(src, "_blank", "noopener,noreferrer");
  };

  const stamp = formatStamp(timestamp);

  return (
    <>
      <button
        ref={thumbRef}
        type="button"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={onEnter}
        onBlur={onLeave}
        onKeyDown={onKey}
        onClick={onClick}
        aria-label={alt}
        aria-expanded={hover}
        className={className}
        style={thumbStyle}
      >
        {!loaded && !failed && <Skeleton />}
        {failed ? (
          <FailedFace />
        ) : (
          <img
            src={src}
            alt={alt}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            style={{
              ...imgStyle,
              opacity: loaded ? 1 : 0,
            }}
          />
        )}
        {stamp && <TimestampTag text={stamp} compact />}
      </button>

      {hover && portalReady && coords
        ? createPortal(
            <Preview
              src={src}
              alt={alt}
              caption={caption}
              stamp={stamp}
              top={coords.top}
              left={coords.left}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* preview card                                                                */
/* -------------------------------------------------------------------------- */

interface PreviewProps {
  src: string;
  alt: string;
  caption?: string;
  stamp: string | null;
  top: number;
  left: number;
}

function Preview({ src, alt, caption, stamp, top, left }: PreviewProps) {
  return (
    <div
      role="dialog"
      aria-label={alt}
      style={{
        position: "fixed",
        top,
        left,
        width: `${PREVIEW_W}px`,
        zIndex: 1000,
        pointerEvents: "none",
        background: "var(--bg-raised)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-lg)",
        boxShadow:
          "0 24px 64px -16px oklch(0 0 0 / 0.65), 0 0 0 1px oklch(0 0 0 / 0.35)",
        overflow: "hidden",
        transition: "opacity var(--dur-fast) var(--ease-out)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: `${PREVIEW_W}px`,
          height: `${PREVIEW_H}px`,
          background: "var(--bg-base)",
        }}
      >
        <img
          src={src}
          alt={alt}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
          }}
        />
        {stamp && <TimestampTag text={stamp} compact={false} />}
      </div>
      {caption && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--border)",
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            lineHeight: 1.45,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {caption}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* small bits                                                                  */
/* -------------------------------------------------------------------------- */

function Skeleton() {
  // Uses the existing `pulse` keyframe defined in globals.css. The keyframe
  // scales to 1.3× at the halfway point which is invisible on an `inset: 0`
  // element clipped by the thumb — only the opacity cycle shows through, which
  // is exactly the shimmer we want without adding a new keyframe to globals.
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--bg-hover)",
        opacity: 0.6,
        animation: "pulse 1.8s cubic-bezier(0.32, 0.72, 0, 1) infinite",
      }}
    />
  );
}

function FailedFace() {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--error)",
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        background: "var(--error-bg)",
      }}
    >
      ✕
    </span>
  );
}

function TimestampTag({
  text,
  compact,
}: {
  text: string;
  compact: boolean;
}) {
  return (
    <span
      style={{
        position: "absolute",
        right: compact ? "2px" : "6px",
        bottom: compact ? "2px" : "6px",
        padding: compact ? "1px 3px" : "2px 6px",
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        lineHeight: 1,
        fontVariantNumeric: "tabular-nums",
        color: "var(--text-primary)",
        background: "oklch(0 0 0 / 0.65)",
        borderRadius: "var(--radius-sm)",
        pointerEvents: "none",
        letterSpacing: "0.02em",
      }}
    >
      {text}
    </span>
  );
}

function formatStamp(ts: number | null): string | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  const d = new Date(ts * 1000);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/* -------------------------------------------------------------------------- */
/* static styles                                                               */
/* -------------------------------------------------------------------------- */

const thumbStyle: CSSProperties = {
  position: "relative",
  width: `${THUMB_W}px`,
  height: `${THUMB_H}px`,
  flexShrink: 0,
  padding: 0,
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg-raised)",
  overflow: "hidden",
  cursor: "zoom-in",
  display: "block",
  transition:
    "border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)",
};

const imgStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
  transition: "opacity var(--dur-normal) var(--ease-out)",
};

export default ScreenshotThumb;
