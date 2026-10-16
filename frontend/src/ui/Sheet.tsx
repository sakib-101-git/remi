import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "../lib/format";
import { IconButton } from "./Button";

// Escape closes only the top-most overlay: sheets/dialogs listen in the capture phase and stop the event,
// so an article opened from the chat closes first and the chat panel stays open.
function useEscape(open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
}

/** Side panel: right side on desktop, full screen on mobile. Used for chat, articles, demo controls and reviews. */
export function Sheet({
  open, onClose, title, subtitle, children, footer, width = "md", testId, scrim = true, side = "right",
}: {
  open: boolean; onClose: () => void; title?: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode;
  width?: "md" | "lg"; testId?: string; scrim?: boolean; side?: "right" | "left";
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50" data-testid={testId}>
      {scrim && <div className="absolute inset-0 animate-fade-in bg-scrim" onClick={onClose} />}
      <aside
        role="dialog"
        aria-modal="true"
        className={cx(
          "absolute inset-y-0 flex w-full animate-slide-in flex-col bg-surface shadow-float md:inset-y-3 md:rounded-card",
          side === "right" ? "right-0 md:right-3" : "left-0 md:left-3",
          width === "md" ? "md:w-[440px]" : "md:w-[560px]",
        )}
      >
        {(title || subtitle) && (
          <header className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
            <div className="min-w-0">
              <div className="text-h2">{title}</div>
              {subtitle && <div className="text-small text-ink-muted">{subtitle}</div>}
            </div>
            <IconButton label="Close" onClick={onClose} className="-mr-2"><X className="h-5 w-5" /></IconButton>
          </header>
        )}
        <div className="scroll-thin flex-1 overflow-y-auto">{children}</div>
        {footer && <footer className="border-t border-line px-6 py-4">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

/** Centred dialog for short, blocking decisions (consent, limit change). */
export function Dialog({ open, onClose, children, testId, dismissable = true }: { open: boolean; onClose: () => void; children: ReactNode; testId?: string; dismissable?: boolean }) {
  useEscape(open && dismissable, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4" data-testid={testId}>
      <div className="absolute inset-0 animate-fade-in bg-scrim" onClick={dismissable ? onClose : undefined} />
      <div role="dialog" aria-modal="true" className="relative max-h-[92vh] w-full max-w-[520px] animate-rise overflow-y-auto rounded-card bg-surface p-8 shadow-float">
        {children}
      </div>
    </div>,
    document.body,
  );
}
