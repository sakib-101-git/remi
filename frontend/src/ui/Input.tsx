import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "../lib/format";
import { Flag } from "./Flag";

const FIELD = "w-full rounded-input border border-line bg-surface text-body text-ink placeholder:text-ink-muted transition-colors focus:border-primary focus:outline-none";

export function Field({ label, hint, children, className }: { label?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      {label && <span className="mb-2 block text-small text-ink-muted">{label}</span>}
      {children}
      {hint && <span className="mt-2 block text-caption text-ink-muted">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }>(function Input({ className, leading, ...rest }, ref) {
  if (!leading) return <input ref={ref} className={cx(FIELD, "h-12 px-4", className)} {...rest} />;
  return (
    <div className={cx("relative", className)}>
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted">{leading}</span>
      <input ref={ref} className={cx(FIELD, "h-12 pl-12 pr-4")} {...rest} />
    </div>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(FIELD, "px-4 py-3", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cx("relative", className)}>
      <select className={cx(FIELD, "h-12 appearance-none pl-4 pr-10")} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" />
    </div>
  );
}

/** Wise-style money field: a big amount on the left, flag + currency on the right. */
export function AmountInput({
  label, value, onChange, currency, currencies, onCurrency, readOnly, testId, loading,
}: {
  label: string; value: string; onChange?: (v: string) => void; currency: string; currencies?: string[];
  onCurrency?: (c: string) => void; readOnly?: boolean; testId?: string; loading?: boolean;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const shown = focused || !value || Number.isNaN(Number(value)) ? value : Number(value).toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return (
    <div className="rounded-input border border-line bg-surface px-4 pb-3 pt-2.5 transition-colors focus-within:border-primary">
      <label htmlFor={id} className="block text-small text-ink-muted">{label}</label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          data-testid={testId}
          inputMode="decimal"
          autoComplete="off"
          value={shown}
          readOnly={readOnly}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange?.(e.target.value.replace(/[^\d.,]/g, "").replace(/,/g, ""))}
          placeholder="0"
          className={cx("min-w-0 flex-1 bg-transparent tabular text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none", (shown?.length ?? 0) > 9 ? "text-h2 sm:text-h1" : "text-h1", loading && "opacity-50")}
        />
        <div className="relative flex shrink-0 items-center gap-2 rounded-full bg-surface-muted py-2 pl-2 pr-3">
          <Flag currency={currency} size={28} />
          <span className="text-body-strong">{currency}</span>
          {currencies && currencies.length > 1 && onCurrency && (
            <>
              <ChevronDown className="h-4 w-4 text-ink-muted" />
              <select aria-label={`${label} currency`} value={currency} onChange={(e) => onCurrency(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0">
                {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={cx("relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200", checked ? "bg-primary" : "bg-line")}
    >
      <span className={cx("absolute top-1 h-6 w-6 rounded-full bg-surface transition-transform duration-200", checked ? "translate-x-7" : "translate-x-1")} />
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; testId?: string }[]; className?: string }) {
  return (
    <div role="tablist" className={cx("inline-flex rounded-full bg-surface-muted p-1", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          data-testid={it.testId}
          onClick={() => onChange(it.value)}
          className={cx("h-10 rounded-full px-5 text-small font-semibold transition-colors", value === it.value ? "bg-surface text-ink" : "text-ink-muted hover:text-ink")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Filter chips (single select). */
export function Chips<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cx("h-9 rounded-full border px-4 text-small transition-colors", value === it.value ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink hover:border-ink-muted")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
