import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/format";

type CardTone = "surface" | "muted" | "primary" | "mint" | "danger" | "warning";

const TONE: Record<CardTone, string> = {
  surface: "bg-surface border border-line",
  muted: "bg-surface-muted",
  primary: "bg-primary text-on-primary",
  mint: "bg-primary-soft",
  danger: "bg-surface border-2 border-danger",
  warning: "bg-surface border border-warning",
};

export function Card({ tone = "surface", pad = true, className, children, ...rest }: { tone?: CardTone; pad?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("rounded-card", TONE[tone], pad && "p-6", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-4 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-h2">{title}</h2>
        {description && <p className="mt-1 text-small text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
