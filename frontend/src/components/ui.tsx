import { type ButtonHTMLAttributes, type ReactNode, useEffect } from "react";
import { AlertTriangle, Inbox, Loader2, X } from "lucide-react";
import { cx } from "../lib/format";

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={cx("panel rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)]", pad && "p-5", className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, icon, right }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">{icon}</div>}
        <div>
          <h3 className="font-display text-[15px] font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="text-muted mt-0.5 text-xs">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export function Button({ variant = "primary", size = "md", loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const base = "focus-ring inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-sm" };
  const variants: Record<Variant, string> = {
    primary: "bg-brand-500 text-white shadow-sm shadow-brand-500/25 hover:bg-brand-600",
    secondary: "panel-2 border border-soft hover:border-brand-400/60",
    ghost: "hover:bg-black/5 dark:hover:bg-white/5",
    danger: "bg-rose-600 text-white hover:bg-rose-700",
    outline: "border border-soft hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-300",
  };
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} disabled={loading || rest.disabled} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

const TIER_STYLE: Record<string, string> = {
  T0: "bg-slate-500/10 text-slate-600 dark:text-slate-300 ring-slate-500/20",
  T1: "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/25",
  T2: "bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  T3: "bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-500/30",
  T4: "bg-violet-500/12 text-violet-700 dark:text-violet-300 ring-violet-500/30",
};
const TIER_LABEL: Record<string, string> = { T0: "Read", T1: "Low-risk write", T2: "Money · confirm", T3: "High risk · step-up", T4: "Governance · human only" };

export function TierBadge({ tier, short = false }: { tier: string; short?: boolean }) {
  return (
    <span title={TIER_LABEL[tier]} className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset", TIER_STYLE[tier] ?? TIER_STYLE.T0)}>
      {tier}
      {!short && <span className="font-medium opacity-80">· {TIER_LABEL[tier]}</span>}
    </span>
  );
}

const TONES: Record<string, string> = {
  neutral: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  brand: "bg-brand-500/10 text-brand-700 dark:text-brand-300",
  success: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  danger: "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  info: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  violet: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
};
export function Badge({ tone = "neutral", children, className }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", TONES[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  settled: "success", executed: "success", processing: "info", pending: "warning", awaiting_confirmation: "warning", awaiting_step_up: "danger",
  scheduled: "violet", blocked: "danger", failed: "danger", cancelled: "neutral", expired: "neutral", active: "brand", triggered: "success",
};
export function StatusPill({ status }: { status: string }) {
  const live = ["pending", "processing", "awaiting_step_up", "scheduled"].includes(status);
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"}>
      {live && <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-current" />}
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-black/5 dark:bg-white/5", className)} />;
}

export function Empty({ title, body, icon, action }: { title: string; body?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="panel-2 grid h-11 w-11 place-items-center rounded-2xl text-muted">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="font-medium">{title}</p>
      {body && <p className="text-muted max-w-sm text-sm">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && <button className="font-medium underline" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Modal({ open, onClose, children, title, wide }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className={cx("panel w-full animate-slide-up rounded-2xl p-6 shadow-2xl", wide ? "max-w-2xl" : "max-w-md")} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">{title}</h2>
            <button className="text-muted rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/5" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/30 backdrop-blur-[2px] animate-fade-in" onClick={onClose}>
      <aside className="panel flex h-full w-full max-w-lg flex-col border-l shadow-2xl animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-soft px-5 py-4">
          <div className="font-display font-semibold">{title}</div>
          <button className="text-muted rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/5" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

export function Toggle({ checked, onChange, label, danger }: { checked: boolean; onChange: (v: boolean) => void; label?: string; danger?: boolean }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={cx("focus-ring relative h-6 w-11 rounded-full transition-colors", checked ? (danger ? "bg-rose-600" : "bg-brand-500") : "bg-slate-300 dark:bg-slate-700")}>
      <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

export function Meter({ value, max = 100, tone = "brand", className }: { value: number; max?: number; tone?: "brand" | "warning" | "danger" | "success"; className?: string }) {
  const color = { brand: "bg-brand-500", warning: "bg-amber-500", danger: "bg-rose-500", success: "bg-emerald-500" }[tone];
  return (
    <div className={cx("h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10", className)}>
      <div className={cx("h-full rounded-full transition-all duration-700", color)} style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  );
}

export function Row({ label, value, strong, mono }: { label: ReactNode; value: ReactNode; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className={cx("num text-right", strong && "font-semibold", mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {right}
    </div>
  );
}
