// Money, date and copy formatting. Rules: currency symbol + thousands separators; no decimals on overview numbers,
// decimals on transactions and receipts; human dates ("1 Jan 2027"), never ISO strings in the UI.

const SYMBOLS: Record<string, string> = { GBP: "£", USD: "$", BDT: "৳", CAD: "C$", NGN: "₦", INR: "₹", EUR: "€" };

export const CURRENCY_NAME: Record<string, string> = {
  BDT: "Bangladeshi taka", GBP: "British pound", USD: "US dollar", CAD: "Canadian dollar", NGN: "Nigerian naira", INR: "Indian rupee", EUR: "Euro",
};

export const HOME_CURRENCY: Record<string, string> = { BD: "BDT", NG: "NGN", IN: "INR" };
export const COUNTRY_NAME: Record<string, string> = { UK: "the UK", GB: "the UK", CA: "Canada", US: "the US", BD: "Bangladesh", NG: "Nigeria", IN: "India" };

export function symbol(currency?: string): string {
  return currency ? SYMBOLS[currency] ?? "" : "";
}

/** money(1819.12, "CAD") → "C$1,819.12"; money(1819.12, "CAD", { whole: true }) → "C$1,819". */
export function money(amount: string | number | null | undefined, currency?: string, opts: { whole?: boolean; signed?: boolean } = {}): string {
  if (amount === null || amount === undefined || amount === "") return "–";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  const decimals = opts.whole ? 0 : 2;
  const body = new Intl.NumberFormat("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(n));
  const sym = symbol(currency);
  const sign = n < 0 ? "−" : opts.signed && n > 0 ? "+" : "";
  return sym ? `${sign}${sym}${body}` : currency ? `${sign}${body} ${currency}` : `${sign}${body}`;
}

/** "1531991.57 BDT" → "৳1,531,991.57" */
export function moneyText(text: string | null | undefined, opts: { whole?: boolean } = {}): string {
  if (!text) return "–";
  const m = String(text).match(/^(-?[\d.]+)\s+([A-Z]{3})$/);
  return m ? money(m[1], m[2], opts) : String(text);
}

/** Rewrites "154.93 GBP" style amounts inside backend sentences into "£155". */
export function humanizeAmounts(text: string): string {
  return text.replace(/(-?\d[\d,]*(?:\.\d+)?)\s?(GBP|USD|BDT|CAD|NGN|INR|EUR)\b/g, (_m, num: string, ccy: string) => money(num.replace(/,/g, ""), ccy, { whole: true }));
}

/** Backend sentences in student language: rounded percentages, money symbols, no finance jargon. */
export function plain(text: string): string {
  return humanizeAmounts(text)
    .replace(/-?\d+\.\d+%/g, (m) => `${Math.round(Number(m.slice(0, -1)))}%`)
    .replace(/extends your runway by ~?(\d+) days/gi, "makes your money last about $1 days longer")
    .replace(/adds days to your runway/gi, "makes your money last longer")
    .replace(/\brunway\b/gi, "how long your money lasts")
    .replace(/\/month\b/g, " a month");
}

function toDate(iso?: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "1 Jan 2027" */
export function date(iso?: string | null): string {
  const d = toDate(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "–";
}

/** "Fri 24 Oct" */
export function shortDate(iso?: string | null): string {
  const d = toDate(iso);
  return d ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` : "–";
}

/** "17 Oct, 00:42" */
export function dateTime(iso?: string | null): string {
  const d = toDate(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : "–";
}

/** "October 2026" */
export function monthYear(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export function daysBetween(fromIso: string | null | undefined, toIso: string | null | undefined): number | null {
  const a = toDate(fromIso);
  const b = toDate(toIso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** "in 44 days", "tomorrow", "today", "3 days ago" */
export function relative(days: number | null | undefined): string {
  if (days === null || days === undefined) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export function greeting(simNowIso?: string | null): string {
  const h = toDate(simNowIso)?.getHours() ?? new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function firstName(name?: string | null): string {
  return (name ?? "").split(/\s+/)[0] ?? "";
}

export function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
