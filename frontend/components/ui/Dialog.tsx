"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

// Mission Control dialog — hand-rolled, no radix.
// Backdrop blur, centered card, Esc closes, focus trap, locks scroll while open.

type DialogContextValue = {
  onClose: () => void;
  titleId: string;
};

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(component: string): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error(`${component} must be used inside <Dialog>`);
  }
  return ctx;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Accessible label if no DialogTitle is rendered. */
  ariaLabel?: string;
  /** Click on the backdrop closes the dialog. Defaults to true. */
  closeOnBackdropClick?: boolean;
  /** Max width class override. Defaults to a comfortable panel width. */
  className?: string;
}

export function Dialog({
  open,
  onClose,
  children,
  ariaLabel,
  closeOnBackdropClick = true,
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useRef(
    `dialog-title-${Math.random().toString(36).slice(2, 10)}`,
  ).current;

  // Lock scroll + remember focus when opening.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the panel.
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? panel).focus();
    }, 0);

    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = originalOverflow;
      // Return focus to opener if still in DOM.
      const prev = previouslyFocusedRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
    };
  }, [open]);

  // Esc to close + Tab focus trap.
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const node = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      aria-hidden={false}
      role="presentation"
      onKeyDown={handleKeyDown}
    >
      <div
        aria-hidden="true"
        onClick={closeOnBackdropClick ? onClose : undefined}
        className={clsx(
          "absolute inset-0 bg-black/60 backdrop-blur-sm",
          "transition-opacity duration-150",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={clsx(
          "relative mx-4 w-full max-w-lg outline-none",
          "animate-[dialog-in_180ms_cubic-bezier(0.16,1,0.3,1)]",
          className,
        )}
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg, 8px)",
          boxShadow:
            "0 20px 48px -12px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)",
          color: "var(--text-primary)",
        }}
      >
        <DialogContext.Provider value={{ onClose, titleId }}>
          {children}
        </DialogContext.Provider>
      </div>
      <style jsx global>{`
        @keyframes dialog-in {
          from {
            opacity: 0;
            transform: translateY(4px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );

  return createPortal(node, document.body);
}

export interface DialogHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function DialogHeader({
  children,
  className,
  ...rest
}: DialogHeaderProps) {
  return (
    <div
      {...rest}
      className={clsx(
        "flex items-start justify-between gap-4 px-5 pt-5 pb-3",
        className,
      )}
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      {children}
    </div>
  );
}

export interface DialogTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
}

export function DialogTitle({
  children,
  className,
  ...rest
}: DialogTitleProps) {
  const { titleId } = useDialogContext("DialogTitle");
  return (
    <h2
      {...rest}
      id={titleId}
      className={clsx("text-[16px] font-semibold leading-tight", className)}
      style={{ color: "var(--text-primary)" }}
    >
      {children}
    </h2>
  );
}

export interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function DialogContent({
  children,
  className,
  ...rest
}: DialogContentProps) {
  return (
    <div
      {...rest}
      className={clsx("px-5 py-4 text-[13px] leading-[1.5]", className)}
      style={{ color: "var(--text-secondary)" }}
    >
      {children}
    </div>
  );
}

export interface DialogFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function DialogFooter({
  children,
  className,
  ...rest
}: DialogFooterProps) {
  return (
    <div
      {...rest}
      className={clsx(
        "flex items-center justify-end gap-2 px-5 pt-3 pb-5",
        className,
      )}
      style={{ borderTop: "1px solid var(--border)" }}
    >
      {children}
    </div>
  );
}
