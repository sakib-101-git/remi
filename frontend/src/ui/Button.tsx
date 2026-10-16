import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "on-primary";
type Size = "md" | "sm";

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-surface text-ink border border-line hover:border-ink-muted",
  ghost: "text-primary hover:bg-surface-muted",
  danger: "bg-danger text-on-primary hover:opacity-90",
  "on-primary": "bg-on-primary text-primary hover:bg-primary-soft",
};

const SIZE: Record<Size, string> = {
  md: "h-12 px-6 gap-2 text-body-strong",
  sm: "h-10 px-4 gap-2 text-small font-semibold",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-45",
        VARIANT[variant],
        SIZE[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Dots /> : icon}
      {children}
    </button>
  );
});

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx("inline-grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Three pulsing dots: the only loading indicator inside buttons and the chat. */
export function Dots({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1", className)} aria-hidden>
      {[0, 160, 320].map((d) => (
        <span key={d} className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}
