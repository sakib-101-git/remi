import type { ReactNode } from "react";
import { cx } from "../lib/format";

export type Tone = "neutral" | "primary" | "accent" | "success" | "warning" | "danger";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-muted text-ink-muted",
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", icon, children, className, ...rest }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx("inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-caption", TONE[tone], className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}

/** A small tier tag for judges: shown next to plain-language labels, never instead of them. */
export function TierTag({ tier }: { tier?: string | null }) {
  if (!tier) return null;
  return <span className="inline-flex h-6 items-center rounded-full border border-line px-2 text-caption text-ink-muted">{tier}</span>;
}

/** A coloured dot + label, for statuses inside lists. */
export function StatusDot({ tone, children }: { tone: Tone; children: ReactNode }) {
  const dot: Record<Tone, string> = { neutral: "bg-ink-muted", primary: "bg-primary", accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger" };
  return (
    <span className="inline-flex items-center gap-2 text-caption text-ink-muted">
      <span className={cx("h-2 w-2 rounded-full", dot[tone])} />
      {children}
    </span>
  );
}
