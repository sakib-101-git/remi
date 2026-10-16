const SYMBOLS: Record<string, string> = { GBP: "£", USD: "$", BDT: "৳", CAD: "C$", NGN: "₦", INR: "₹", EUR: "€" };

export function money(amount: string | number | null | undefined, currency?: string, opts: { compact?: boolean; decimals?: number } = {}): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  const decimals = opts.decimals ?? (opts.compact ? 0 : 2);
  const body = opts.compact && Math.abs(n) >= 100000
    ? new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 }).format(n)
    : new Intl.NumberFormat("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
  const sym = currency ? SYMBOLS[currency] ?? "" : "";
  return sym ? `${sym}${body}` : currency ? `${body} ${currency}` : body;
}

/** "1531991.57 BDT" → "৳1,531,991.57" */
export function moneyText(text: string | null | undefined): string {
  if (!text) return "—";
  const m = String(text).match(/^(-?[\d.]+)\s+([A-Z]{3})$/);
  return m ? money(m[1], m[2]) : String(text);
}

export function date(iso?: string | null, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: withTime ? undefined : "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
}

export function relDays(iso?: string | null, from?: string): string {
  if (!iso) return "";
  const a = new Date(iso).getTime();
  const b = from ? new Date(from).getTime() : Date.now();
  const days = Math.round((a - b) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  return `${-days} days ago`;
}

export function pct(v: string | number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "—";
  return `${Number(v).toFixed(digits)}%`;
}

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
