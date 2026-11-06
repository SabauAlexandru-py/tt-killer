"use client";

/**
 * ui-store — single source of truth for cross-layout UI state:
 *   - navCollapsed: left Nav expanded (240px) vs collapsed (56px)
 *   - inspector:    { title, body } shown in the right Inspector pane,
 *                   or null when nothing is selected
 *
 * Kept as React Context (zustand isn't in package.json; adding it here
 * without a pnpm install would leave a broken import). Context is listed
 * as a valid alternative in the design spec. API intentionally shaped
 * like a zustand store so we can swap later without touching callers.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface InspectorContent {
  /** Title shown in the Inspector header. */
  title: string;
  /** Rendered as the Inspector body. */
  body: ReactNode;
  /**
   * Optional stable id — when the same id is re-set we don't flicker
   * the slide-in animation.
   */
  id?: string;
}

export interface UIState {
  navCollapsed: boolean;
  toggleNav: () => void;
  setNavCollapsed: (collapsed: boolean) => void;

  inspector: InspectorContent | null;
  /** Open or replace the Inspector. */
  openInspector: (content: InspectorContent) => void;
  /** Close the Inspector (sets content to null → slides out). */
  closeInspector: () => void;
}

const UIContext = createContext<UIState | null>(null);

const NAV_STORAGE_KEY = "adspower-ui:nav-collapsed";

function readStoredNavCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NAV_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredNavCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NAV_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    /* localStorage can be unavailable in private mode — ignore */
  }
}

export interface UIProviderProps {
  children: ReactNode;
}

export function UIProvider({ children }: UIProviderProps) {
  // Start with `false` for a stable SSR match; hydrate from localStorage
  // in an effect to avoid a mismatch flash.
  const [navCollapsed, setNavCollapsedState] = useState<boolean>(false);
  const [inspector, setInspector] = useState<InspectorContent | null>(null);

  useEffect(() => {
    const stored = readStoredNavCollapsed();
    if (stored) setNavCollapsedState(true);
  }, []);

  const setNavCollapsed = useCallback((collapsed: boolean) => {
    setNavCollapsedState(collapsed);
    writeStoredNavCollapsed(collapsed);
  }, []);

  const toggleNav = useCallback(() => {
    setNavCollapsedState((prev) => {
      const next = !prev;
      writeStoredNavCollapsed(next);
      return next;
    });
  }, []);

  const openInspector = useCallback((content: InspectorContent) => {
    setInspector(content);
  }, []);

  const closeInspector = useCallback(() => {
    setInspector(null);
  }, []);

  // Esc closes the Inspector (per DESIGN_SPEC: "Esc closes panels").
  useEffect(() => {
    if (!inspector) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInspector(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspector]);

  const value = useMemo<UIState>(
    () => ({
      navCollapsed,
      toggleNav,
      setNavCollapsed,
      inspector,
      openInspector,
      closeInspector,
    }),
    [
      navCollapsed,
      toggleNav,
      setNavCollapsed,
      inspector,
      openInspector,
      closeInspector,
    ],
  );

  return createElement(UIContext.Provider, { value }, children);
}

/**
 * Access the UI store from any client component. Must be used inside
 * <UIProvider /> (wired in app/providers.tsx).
 */
export function useUI(): UIState {
  const ctx = useContext(UIContext);
  if (!ctx) {
    throw new Error(
      "useUI must be used inside <UIProvider /> — add it to app/providers.tsx",
    );
  }
  return ctx;
}

/** Narrow selector: subscribe only to nav state. */
export function useNavState() {
  const { navCollapsed, toggleNav, setNavCollapsed } = useUI();
  return { navCollapsed, toggleNav, setNavCollapsed };
}

/** Narrow selector: subscribe only to inspector state. */
export function useInspectorState() {
  const { inspector, openInspector, closeInspector } = useUI();
  return { inspector, openInspector, closeInspector };
}

/** Widths (px) — match DESIGN_SPEC layout section. */
export const NAV_WIDTH_EXPANDED = 240;
export const NAV_WIDTH_COLLAPSED = 56;
export const INSPECTOR_WIDTH = 360;
