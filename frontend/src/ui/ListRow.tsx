import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "../lib/format";

/** One row of a list: leading visual, title + secondary line, trailing value. Clickable when onClick is set. */
export function ListRow({
  leading, title, subtitle, trailing, trailingSub, onClick, chevron, className, ...rest
}: {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; trailingSub?: ReactNode;
  onClick?: () => void; chevron?: boolean; className?: string;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cx("flex w-full items-center gap-4 py-3 text-left", onClick && "-mx-3 rounded-input px-3 transition-colors hover:bg-surface-muted", className)}
      {...rest}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-strong">{title}</div>
        {subtitle && <div className="truncate text-small text-ink-muted">{subtitle}</div>}
      </div>
      {(trailing || trailingSub) && (
        <div className="shrink-0 text-right tabular">
          {trailing && <div className="text-body-strong">{trailing}</div>}
          {trailingSub && <div className="text-small text-ink-muted">{trailingSub}</div>}
        </div>
      )}
      {chevron && <ChevronRight className="h-5 w-5 text-ink-muted" />}
    </Tag>
  );
}

/** A round icon holder for list rows. */
export function RowIcon({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "primary" | "success" | "danger" | "accent" }) {
  const t = { muted: "bg-surface-muted text-ink", primary: "bg-primary text-on-primary", success: "bg-success-soft text-success", danger: "bg-danger-soft text-danger", accent: "bg-accent-soft text-accent-text" }[tone];
  return <div className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-full", t)}>{children}</div>;
}

export function Divided({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("divide-y divide-line", className)}>{children}</div>;
}
