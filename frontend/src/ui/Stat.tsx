import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/format";

/** A label + one big number. The only place `text-amount-xl` is used. */
export function Stat({ label, value, sub, className, testId }: { label?: ReactNode; value: ReactNode; sub?: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={className}>
      {label && <div className="text-small text-ink-muted">{label}</div>}
      <div data-testid={testId} className="text-amount-xl">{value}</div>
      {sub && <div className="mt-1 text-small text-ink-muted">{sub}</div>}
    </div>
  );
}

/** Two aligned label/value columns, used in review cards and receipts. */
export function KeyValue({ label, value, strong, className }: { label: ReactNode; value: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-4 py-2", className)}>
      <span className="text-small text-ink-muted">{label}</span>
      <span className={cx("text-right tabular", strong ? "text-body-strong" : "text-small")}>{value}</span>
    </div>
  );
}

/** Animates a number once from 0 on first render (respects reduced motion). */
export function useCountUp(target: number, ms = 700): number {
  const [value, setValue] = useState(target);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !Number.isFinite(target) || target === 0) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    done.current = true;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setValue(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    setValue(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  useEffect(() => {
    if (done.current) setValue(target);
  }, [target]);
  return value;
}
