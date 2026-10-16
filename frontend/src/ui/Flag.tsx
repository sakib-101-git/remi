import bd from "circle-flags/flags/bd.svg";
import ca from "circle-flags/flags/ca.svg";
import eu from "circle-flags/flags/european_union.svg";
import gb from "circle-flags/flags/gb.svg";
import inFlag from "circle-flags/flags/in.svg";
import ng from "circle-flags/flags/ng.svg";
import us from "circle-flags/flags/us.svg";
import { cx } from "../lib/format";

const BY_CURRENCY: Record<string, string> = { BDT: bd, GBP: gb, USD: us, CAD: ca, NGN: ng, INR: inFlag, EUR: eu };
const BY_COUNTRY: Record<string, string> = { BD: bd, GB: gb, UK: gb, US: us, CA: ca, NG: ng, IN: inFlag };

/** Round currency/country flag (circle-flags, MIT). */
export function Flag({ currency, country, size = 24, className }: { currency?: string; country?: string; size?: number; className?: string }) {
  const src = (currency && BY_CURRENCY[currency]) || (country && BY_COUNTRY[country]);
  if (!src) return <span className={cx("inline-block shrink-0 rounded-full bg-surface-muted", className)} style={{ width: size, height: size }} />;
  return <img src={src} alt="" width={size} height={size} className={cx("shrink-0 rounded-full", className)} />;
}
