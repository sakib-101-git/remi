import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "../lib/format";
import { useStore } from "../lib/store";

/** Attach to a page's h1: the top bar shows the page name once this heading scrolls out of view. */
export function useTitleRef() {
  const ref = useRef<HTMLHeadingElement>(null);
  const { setTitleVisible } = useStore();
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setTitleVisible(e.isIntersecting), { rootMargin: "-72px 0px 0px 0px" });
    io.observe(el);
    return () => {
      io.disconnect();
      setTitleVisible(true);
    };
  }, [setTitleVisible]);
  return ref;
}

/** Shared page header: one h1, an optional one-line description and one optional primary action. */
export function PageHeader({ title, description, action, children }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  const ref = useTitleRef();
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 ref={ref} className="text-h1">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-body text-ink-muted">{description}</p>}
        {children}
      </div>
      {action}
    </header>
  );
}

export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("space-y-4", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-4">
          {title && <h2 className="text-h2">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** "Details" pattern: collapsed by default, keeps secondary information out of the way. */
export function Disclosure({ summary, children, defaultOpen = false, testId }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-line" data-testid={testId}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 py-4 text-left text-body-strong">
        {summary}
        <ChevronDown className={cx("h-5 w-5 text-ink-muted transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && <div className="animate-rise pb-4">{children}</div>}
    </div>
  );
}

/** A plain text link styled button. */
export function TextLink({ children, onClick, className, ...rest }: { children: ReactNode; onClick?: () => void; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button onClick={onClick} className={cx("text-small font-semibold text-primary underline-offset-4 hover:underline", className)} {...rest}>
      {children}
    </button>
  );
}
