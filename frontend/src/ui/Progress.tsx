import { Check } from "lucide-react";
import { cx } from "../lib/format";

/** Horizontal progress bar. */
export function Meter({ value, max = 100, tone = "primary", className, label }: { value: number; max?: number; tone?: "primary" | "accent" | "warning" | "danger"; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const fill = { primary: "bg-primary", accent: "bg-accent", warning: "bg-warning", danger: "bg-danger" }[tone];
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-surface-muted", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx("h-full rounded-full transition-[width] duration-700 ease-out", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Circular score ring (credit readiness). */
export function Ring({ value, size = 120, label }: { value: number; size?: number; label?: string }) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label ?? `${value} out of 100`}>
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-surface-muted" />
        {value > 0 && <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-primary transition-[stroke-dasharray] duration-700" strokeDasharray={`${(Math.min(100, value) / 100) * c} ${c}`} />}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-h1 tabular">{value}</div>
    </div>
  );
}

export type TimelineStep = { key: string; label: string; detail?: string };

/** Live status timeline: Sent → On its way → Arrived. `current` is the index of the latest reached step. */
export function Timeline({ steps, current, testId }: { steps: TimelineStep[]; current: number; testId?: string }) {
  return (
    <ol className="flex items-start" data-testid={testId}>
      {steps.map((s, i) => {
        const done = i <= current;
        return (
          <li key={s.key} className="relative flex flex-1 flex-col items-center text-center" data-state={done ? "done" : "todo"} data-step={s.key}>
            {i > 0 && <span className={cx("absolute right-1/2 top-4 h-0.5 w-full -translate-y-1/2 transition-colors duration-500", i <= current ? "bg-success" : "bg-line")} />}
            <span className={cx("relative z-10 grid h-8 w-8 place-items-center rounded-full border-2 transition-colors duration-500", done ? "border-success bg-success text-on-primary" : "border-line bg-surface")}>
              {done && <Check className="h-4 w-4" />}
            </span>
            <span className={cx("mt-2 text-caption", done ? "text-ink" : "text-ink-muted")}>{s.label}</span>
            {s.detail && <span className="text-caption text-ink-muted">{s.detail}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Horizontal bar list (the only chart style): brand colour bars, amount at the end, one optional highlight. */
export function BarList({ rows, highlight, format }: { rows: { label: string; value: number; badge?: React.ReactNode }[]; highlight?: string; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-small"><span className="truncate">{r.label}</span>{r.badge}</span>
            <span className="text-small font-semibold tabular">{format(r.value)}</span>
          </div>
          <div className="h-3 w-full rounded-full bg-surface-muted">
            <div className={cx("h-full rounded-full transition-[width] duration-700 ease-out", r.label === highlight ? "bg-accent" : "bg-primary")} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
