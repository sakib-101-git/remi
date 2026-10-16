import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, BadgeCheck, CheckCircle2, Clock, Fingerprint, Lock, ShieldAlert, ShieldCheck, Smartphone, UserPlus, XCircle } from "lucide-react";
import { api, idemKey } from "../../lib/api";
import { cx, date, moneyText } from "../../lib/format";
import { useStore } from "../../lib/store";
import { Badge, Button, Meter, Row, StatusPill, TierBadge } from "../ui";

export type ActionData = {
  id: string;
  kind: "payment" | "fx_conversion" | "add_beneficiary";
  status: string;
  tier: string;
  summary: Record<string, any>;
  payload: Record<string, any>;
  risk_score: number;
  risk_reasons: { rule: string; points: number; reason: string }[];
  policy_reasons: string[];
  requires_step_up: boolean;
  not_before: string | null;
  expires_at: string | null;
  result: Record<string, any>;
  confirm_token?: string | null;
  error?: string;
};

function useSimNow(): number {
  const { session } = useStore();
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return tick + (session?.clock_offset_seconds ?? 0) * 1000;
}

function countdown(target: string | null, nowMs: number): string | null {
  if (!target) return null;
  const s = Math.max(0, Math.round((new Date(target).getTime() - nowMs) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const KIND_ICON = { payment: ArrowRightLeft, fx_conversion: ArrowRightLeft, add_beneficiary: UserPlus };

export function ActionCard({ initial }: { initial: ActionData }) {
  const { liveEvents, setPhoneOpen, pushToast, bump } = useStore();
  const [action, setAction] = useState<ActionData>(initial);
  const [token] = useState<string | null | undefined>(initial.confirm_token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [showRisk, setShowRisk] = useState(initial.tier === "T3" || initial.status === "blocked");
  const idem = useRef<{ confirm: string; stepup: string }>({ confirm: idemKey(), stepup: idemKey() });
  const nowMs = useSimNow();

  useEffect(() => {
    const latest = [...liveEvents].reverse().find((e) => e.event === "action" && e.data.id === action.id);
    if (latest && latest.at > 0) setAction((a) => ({ ...a, ...latest.data, confirm_token: a.confirm_token }));
  }, [liveEvents, action.id]);

  const reference: string | undefined = action.result?.receipt?.reference ?? action.result?.reference;
  const txnStatus = useMemo(() => {
    const ev = [...liveEvents].reverse().find((e) => e.event === "transaction" && reference && e.data.reference === reference);
    return ev?.data.status ?? action.result?.receipt?.status;
  }, [liveEvents, reference, action.result]);

  const expired = action.status === "awaiting_confirmation" && action.expires_at && new Date(action.expires_at).getTime() < nowMs;
  const s = action.summary || {};
  const Icon = KIND_ICON[action.kind] ?? ArrowRightLeft;
  const blocked = action.status === "blocked";
  const fraud = action.risk_reasons?.some((r) => r.rule === "registry_mismatch" || r.rule === "injection_in_source");

  async function confirm() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const out = await api.post<any>(`/actions/${action.id}/confirm`, { token }, { "Idempotency-Key": idem.current.confirm });
      if (out.status === "rejected" || out.error) {
        setError(out.error);
      } else {
        setAction((a) => ({ ...a, ...out }));
        if (out.status === "awaiting_step_up") setPhoneOpen(true);
        if (out.status === "executed") pushToast({ kind: "executed", title: "Done - executed in the sandbox", body: s.title });
      }
      bump();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function stepUp() {
    setBusy(true);
    setError(null);
    try {
      const out = await api.post<any>(`/actions/${action.id}/stepup`, { code }, { "Idempotency-Key": idem.current.stepup });
      if (out.status === "rejected" || out.error) {
        setError(out.error);
        idem.current.stepup = idemKey();
      } else {
        setAction((a) => ({ ...a, ...out }));
        if (out.status === "executed") pushToast({ kind: "executed", title: "Verified and executed", body: s.title });
      }
      bump();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      const out = await api.post<any>(`/actions/${action.id}/cancel`);
      setAction((a) => ({ ...a, ...out }));
      bump();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const headerTone = blocked ? "from-rose-500/15" : action.status === "executed" ? "from-emerald-500/12" : action.tier === "T3" ? "from-rose-500/10" : "from-amber-500/10";

  return (
    <div data-testid="action-card" className={cx("panel overflow-hidden rounded-2xl", blocked && "border-rose-500/40")}>
      <div className={cx("flex items-start justify-between gap-3 bg-gradient-to-r to-transparent px-4 py-3", headerTone)}>
        <div className="flex items-start gap-3">
          <div className={cx("mt-0.5 grid h-9 w-9 place-items-center rounded-xl", blocked ? "bg-rose-500/15 text-rose-600" : "bg-brand-500/12 text-brand-600 dark:text-brand-300")}>
            {blocked ? <ShieldAlert className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
          </div>
          <div>
            <div className="text-muted text-[11px] font-medium uppercase tracking-wider">{blocked ? (fraud ? "Blocked · possible fraud" : "Blocked by policy") : action.status === "executed" ? "Executed in sandbox" : "Needs your approval"}</div>
            <div className="font-display text-[15px] font-semibold leading-snug">{s.title ?? action.kind}</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <TierBadge tier={action.tier} short />
          <StatusPill status={expired ? "expired" : action.status} />
        </div>
      </div>

      <div className="px-4 pb-4 pt-2">
        {action.kind === "payment" && (
          <div className="divide-y divide-[var(--border)]">
            <div className="grid grid-cols-2 gap-3 py-3">
              <div>
                <div className="text-muted text-xs">You send</div>
                <div className="num font-display text-lg font-semibold">{moneyText(s.you_send)}</div>
              </div>
              <div className="text-right">
                <div className="text-muted text-xs">{s.recipient} receives</div>
                <div className="num font-display text-lg font-semibold text-brand-600 dark:text-brand-300">{moneyText(s.they_receive)}</div>
              </div>
            </div>
            <div className="py-1">
              <Row label="Provider" value={s.provider} />
              <Row label="Rate offered" value={s.rate} />
              <Row label="Fee" value={moneyText(s.fee)} />
              <Row label={<span title="Fee + FX markup vs the mid-market rate">True landed cost</span>} value={moneyText(s.landed_cost)} strong />
              <Row label="Recipient" value={<span>{s.recipient} <span className="text-muted font-mono text-xs">{s.recipient_account}</span></span>} />
              <Row label="Bank" value={s.recipient_bank} />
              <Row label="Arrives by (worst case)" value={date(s.arrival)} />
              <Row label="Purpose code" value={<span className="font-mono text-xs">{s.purpose_code}</span>} />
              <Row label="Source of funds" value={s.source_of_funds} />
              <Row label="Reference" value={s.reference} />
            </div>
          </div>
        )}
        {action.kind === "fx_conversion" && (
          <div className="py-2">
            <div className="grid grid-cols-2 gap-3 py-2">
              <div>
                <div className="text-muted text-xs">You sell</div>
                <div className="num font-display text-lg font-semibold">{moneyText(s.you_sell)}</div>
              </div>
              <div className="text-right">
                <div className="text-muted text-xs">You get</div>
                <div className="num font-display text-lg font-semibold text-brand-600 dark:text-brand-300">{moneyText(s.you_get)}</div>
              </div>
            </div>
            <Row label="Rate offered" value={s.rate} />
            <Row label="Mid-market" value={s.mid_rate} />
            <Row label="Cost vs mid-market" value={moneyText(s.cost_vs_mid)} strong />
            <Row label="Provider" value={s.provider} />
            {s.trigger && <Row label="Triggered by" value={<Badge tone="brand">{s.trigger}</Badge>} />}
          </div>
        )}
        {action.kind === "add_beneficiary" && (
          <div className="py-2">
            <Row label="New payee" value={s.recipient} strong />
            <Row label="Bank" value={s.bank} />
            <Row label="Account" value={<span className="font-mono text-xs">{s.account}</span>} />
            <Row label="Type" value={s.kind} />
            <p className="mt-2 flex items-center gap-2 rounded-lg bg-violet-500/8 px-3 py-2 text-xs text-violet-700 dark:text-violet-300"><Clock className="h-3.5 w-3.5" /> {s.cooling_off}</p>
          </div>
        )}

        {(action.policy_reasons?.length > 0 || action.risk_reasons?.length > 0) && (
          <div className="mt-2 rounded-xl border border-soft">
            <button className="flex w-full items-center justify-between px-3 py-2 text-xs" onClick={() => setShowRisk((v) => !v)}>
              <span className="flex items-center gap-2 font-medium"><Fingerprint className="h-3.5 w-3.5" /> Why {blocked ? "blocked" : `tier ${action.tier}`}? · risk score {action.risk_score}/100</span>
              <span className="text-muted">{showRisk ? "Hide" : "Show"}</span>
            </button>
            {showRisk && (
              <div className="space-y-2 border-t border-soft px-3 py-2.5 text-xs">
                <Meter value={action.risk_score} tone={action.risk_score >= 80 ? "danger" : action.risk_score >= 50 ? "warning" : "brand"} />
                {action.policy_reasons?.map((r, i) => (
                  <div key={`p${i}`} className={cx("flex gap-2", blocked ? "text-rose-600 dark:text-rose-300" : "")}>
                    <span>•</span>
                    <span>{r}</span>
                  </div>
                ))}
                {action.risk_reasons?.map((r, i) => (
                  <div key={`r${i}`} className="text-muted flex justify-between gap-3">
                    <span>{r.reason}</span>
                    <span className="num shrink-0 font-mono">+{r.points}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <div className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{error}</div>}

        {action.status === "awaiting_confirmation" && !expired && token && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={confirm} loading={busy} data-testid="confirm-btn" className="flex-1">
              <Lock className="h-4 w-4" /> Confirm {action.kind === "add_beneficiary" ? "payee" : action.kind === "fx_conversion" ? "conversion" : "payment"}
            </Button>
            <Button variant="secondary" onClick={cancel} disabled={busy}>Cancel</Button>
            <div className="text-muted flex w-full items-center justify-between text-[11px]">
              <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Single-use token bound to these exact details. Remi's AI never sees it.</span>
              <span className="num font-mono">{countdown(action.expires_at, nowMs)}</span>
            </div>
          </div>
        )}
        {action.status === "awaiting_confirmation" && !token && !expired && (
          <p className="text-muted mt-3 text-xs">Open the latest card in the chat to confirm (tokens are only shown once).</p>
        )}
        {expired && <p className="text-muted mt-3 text-xs">This proposal expired (5 minutes). Ask Remi again for a fresh quote.</p>}

        {action.status === "awaiting_step_up" && (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Smartphone className="h-4 w-4 text-rose-600" /> Step-up verification</div>
            <p className="text-muted mb-3 text-xs">We sent a 6-digit code to your <button className="font-medium text-brand-600 underline dark:text-brand-300" onClick={() => setPhoneOpen(true)}>Sandbox phone</button>. Enter it to approve this high-risk action.</p>
            <div className="flex gap-2">
              <input data-testid="otp-input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="••••••" className="focus-ring panel-2 num h-10 w-36 rounded-xl border border-soft px-3 text-center font-mono text-lg tracking-[0.3em]" />
              <Button onClick={stepUp} loading={busy} disabled={code.length !== 6} data-testid="verify-btn">Verify</Button>
              <Button variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button>
            </div>
          </div>
        )}

        {action.status === "scheduled" && (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-violet-500/8 px-3 py-3 text-sm text-violet-700 dark:text-violet-300">
            <Clock className="h-4 w-4" />
            <div className="flex-1">Verified. Released automatically after the new-payee cooling-off period.</div>
            <span className="num font-mono">{countdown(action.not_before, nowMs)}</span>
          </div>
        )}

        {action.status === "executed" && action.kind !== "add_beneficiary" && (
          <Receipt result={action.result} txnStatus={txnStatus} kind={action.kind} />
        )}
        {action.status === "executed" && action.kind === "add_beneficiary" && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            <BadgeCheck className="h-4 w-4" /> Payee added. Payments unlock after cooling-off ({date(action.result?.active_after, true)}).
          </div>
        )}
        {(action.status === "cancelled" || action.status === "failed") && (
          <div className="text-muted mt-3 flex items-center gap-2 text-xs"><XCircle className="h-3.5 w-3.5" /> {action.status === "failed" ? `Failed: ${action.result?.error ?? "error"}` : "Cancelled - nothing moved."}</div>
        )}
      </div>
    </div>
  );
}

const STEPS = ["pending", "processing", "settled"];

function Receipt({ result, txnStatus, kind }: { result: Record<string, any>; txnStatus?: string; kind: string }) {
  const r = result?.receipt;
  if (kind === "fx_conversion") {
    return (
      <div className="mt-4 rounded-xl bg-emerald-500/8 p-3 text-sm">
        <div className="mb-1 flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Converted · {result?.reference}</div>
        <div className="text-muted text-xs">Sold {moneyText(result?.sold)} · bought {moneyText(result?.bought)}</div>
        {result?.audit_hash && <div className="text-muted mt-1 font-mono text-[10px]">audit #{String(result.audit_hash).slice(0, 16)}…</div>}
      </div>
    );
  }
  if (!r) return null;
  const status = txnStatus ?? r.status;
  const idx = STEPS.indexOf(status);
  return (
    <div data-testid="receipt" className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Receipt</div>
        <span className="num font-mono text-xs">{r.reference}</span>
      </div>
      <div className="my-3 flex items-center gap-1">
        {STEPS.map((step, i) => (
          <div key={step} className="flex flex-1 items-center gap-1">
            <div className={cx("h-1.5 flex-1 rounded-full transition-colors duration-500", i <= idx ? "bg-emerald-500" : "bg-black/10 dark:bg-white/10")} />
            <span className={cx("text-[10px] capitalize", i <= idx ? "font-semibold text-emerald-700 dark:text-emerald-300" : "text-muted")}>{step}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 text-xs">
        <Row label="Sent" value={moneyText(r.sent)} />
        <Row label="Received" value={moneyText(r.received)} />
        <Row label="Fee" value={moneyText(r.fee)} />
        <Row label="Arrival" value={date(r.expected_arrival)} />
      </div>
      <p className="text-muted mt-2 text-[10px]">{r.disclaimer} {result?.audit_hash && <span className="font-mono">· audit #{String(result.audit_hash).slice(0, 12)}…</span>}</p>
    </div>
  );
}
