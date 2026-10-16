import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cx } from "../lib/format";
import { Button } from "./Button";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("skeleton rounded-input", className)} />;
}

/** Skeleton rows shaped like list rows. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-11 w-11 rounded-full" />
          <div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-1/4" /></div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, action, className }: { icon?: ReactNode; title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center gap-3 rounded-card bg-surface-muted px-6 py-10 text-center", className)}>
      {icon && <div className="text-ink-muted">{icon}</div>}
      <p className="text-body text-ink-muted">{title}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-6 py-10 text-center">
      <CircleAlert className="h-6 w-6 text-danger" />
      <p className="text-body">Something went wrong: {message}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Inline note inside a card (warning / danger / info). */
export function Note({ tone = "neutral", icon, children, className }: { tone?: "neutral" | "warning" | "danger" | "success" | "mint"; icon?: ReactNode; children: ReactNode; className?: string }) {
  const t = { neutral: "bg-surface-muted text-ink", warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger", success: "bg-success-soft text-success", mint: "bg-primary-soft text-primary" }[tone];
  return (
    <div className={cx("flex items-start gap-3 rounded-input px-4 py-3 text-small", t, className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
