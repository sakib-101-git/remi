import { ICON, WORDMARK } from "../brand/marks";
import { cx } from "../lib/format";

/** The remi wordmark (outlined paths, coin i-dot). `tone="reversed"` for green backgrounds. */
export function Wordmark({ height = 28, tone = "default", className }: { height?: number; tone?: "default" | "reversed" | "mono"; className?: string }) {
  const letters = tone === "reversed" ? "fill-on-primary" : tone === "mono" ? "fill-ink" : "fill-primary";
  const dot = tone === "mono" ? "fill-ink" : "fill-accent";
  return (
    <svg viewBox={WORDMARK.viewBox} style={{ height }} className={cx("w-auto shrink-0", className)} role="img" aria-label="remi">
      <path d={WORDMARK.letters} className={letters} />
      <circle cx={WORDMARK.dot.cx} cy={WORDMARK.dot.cy} r={WORDMARK.dot.r} className={dot} />
    </svg>
  );
}

/** The r. app icon on a green tile. */
export function AppIcon({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox={`0 0 ${ICON.tile} ${ICON.tile}`} width={size} height={size} className={cx("shrink-0", className)} role="img" aria-label="Remi">
      <rect width={ICON.tile} height={ICON.tile} rx={ICON.tile * 0.22} className="fill-primary" />
      <path d={ICON.letter} className="fill-on-primary" />
      <circle cx={ICON.dot.cx} cy={ICON.dot.cy} r={ICON.dot.r} className="fill-accent" />
    </svg>
  );
}
