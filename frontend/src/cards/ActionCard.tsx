import { useEffect, useMemo, useRef, useState } from "react";
import { Download, KeyRound, ShieldAlert, Smartphone } from "lucide-react";
import { api, idemKey } from "../lib/api";
import { ACTION_STATUS, TRANSFER_STATUS } from "../lib/copy";
import { cx, moneyText, shortDate } from "../lib/format";
import { useSimNow, useStore } from "../lib/store";
import { Badge, Button, Card, Disclosure, KeyValue, Note, TierTag, Timeline } from "../ui";

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

function countdown(target: string | null, nowMs: number): string | null {
  if (!target) return null;
  const s = Math.max(0, Math.round((new Date(target).getTime() - nowMs) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const CONFIRM_LABEL = { payment: "Confirm and send", fx_conversion: "Confirm conversion", add_beneficiary: "Add recipient" };
const TRACK = [
  { key: "pending", label: "Sent" },
  { key: "processing", label: "On its way" },
  { key: "settled", label: "Arrived" },
];

/** Review → approve → (code) → tracking, all in one card. The approval token only ever lives in this component. */
export function ActionCard({ initial }: { initial: ActionData }) {
  const { liveEvents, pushToast, bump } = useStore();
  const [action, setAction] = useState<ActionData>(initial);
  const [token, setToken] = useState<string | null | undefined>(initial.confirm_token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const idem = useRef({ confirm: idemKey(), stepup: idemKey() });
  const nowMs = useSimNow();

  useEffect(() => {
    const latest = [...liveEvents].reverse().find((e) => e.event === "action" && e.data.id === action.id);
    if (latest) setAction((a) => ({ ...a, ...latest.data, confirm_token: a.confirm_token }));
  }, [liveEvents, action.id]);

  const receipt = action.result?.receipt;
  const reference: string | undefined = receipt?.reference ?? action.result?.reference;
  const transferStatus = useMemo(() => {
    const ev = [...liveEvents].reverse().find((e) => e.event === "transaction" && reference && e.data.reference === reference);
    return ev?.data.status ?? receipt?.status;
  }, [liveEvents, reference, receipt]);

  const s = action.summary || {};
  const expired = action.status === "expired" || (action.status === "awaiting_confirmation" && !!action.expires_at && new Date(action.expires_at).getTime() < nowMs);
  const blocked = action.status === "blocked";
  const fraud = action.risk_reasons?.some((r) => r.rule === "registry_mismatch" || r.rule === "injection_in_source");
  const status = ACTION_STATUS[expired ? "expired" : action.status] ?? { label: action.status, tone: "neutral" as const };

  async function call(path: string, body: unknown, key?: string) {
    setBusy(true);
    setError(null);
    try {
      const out = await api.post<any>(path, body, key ? { "Idempotency-Key": key } : undefined);
      if (out.status === "rejected" || out.error) {
        setError(out.error);
        return null;
      }
      setAction((a) => ({ ...a, ...out }));
      bump();
      return out;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const confirm = async () => {
    if (!token) return;
    const out = await call(`/actions/${action.id}/confirm`, { token }, idem.current.confirm);
    if (out?.status === "executed") pushToast({ kind: "executed", title: action.kind === "payment" ? "Payment sent" : "Done", body: s.title });
  };
  const stepUp = async () => {
    const out = await call(`/actions/${action.id}/stepup`, { code }, idem.current.stepup);
    if (!out) idem.current.stepup = idemKey();
    if (out?.status === "executed") pushToast({ kind: "executed", title: "Verified and sent", body: s.title });
  };
  const reissue = async () => {
    const out = await call(`/actions/${action.id}/reissue`, {});
    if (out?.confirm_token) setToken(out.confirm_token);
  };
  const cancel = () => call(`/actions/${action.id}/cancel`, {});

  const tone = blocked ? "danger" : "surface";
  return (
    <Card tone={tone} data-testid="action-card" data-status={action.status} className="animate-rise">
      <div className="flex items-center justify-between gap-3">
        <Badge tone={status.tone} data-testid="action-status">{blocked && fraud ? "Blocked · possible fraud" : status.label}</Badge>
        <TierTag tier={action.tier} />
      </div>
      <h3 className="mt-3 text-h2">{s.title ?? "Action"}</h3>

      {action.kind === "payment" && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 rounded-input bg-surface-muted p-4">
            <div><div className="text-small text-ink-muted">You send</div><div className="text-h2 tabular">{moneyText(s.you_send)}</div></div>
            <div className="text-right"><div className="text-small text-ink-muted">They receive</div><div className="text-h2 tabular">{moneyText(s.they_receive)}</div></div>
          </div>
          <div className="mt-2">
            <KeyValue label="Arrives by" value={shortDate(s.arrival)} />
            <KeyValue label="Total cost" value={`${moneyText(s.landed_cost)} in fees and markup`} />
            <KeyValue label="To" value={<>{s.recipient} <span className="text-ink-muted">{s.recipient_account}</span></>} />
          </div>
          <Disclosure summary="Payment details">
            <KeyValue label="Provider" value={String(s.provider ?? "").replace(" (sandbox)", "")} />
            <KeyValue label="Exchange rate" value={s.rate} />
            <KeyValue label="Fee" value={moneyText(s.fee)} />
            <KeyValue label="Bank" value={s.recipient_bank} />
            <KeyValue label="Purpose of payment" value={s.purpose_code} />
            <KeyValue label="Source of funds" value={s.source_of_funds} />
            <KeyValue label="Reference" value={s.reference} />
          </Disclosure>
        </>
      )}
      {action.kind === "fx_conversion" && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 rounded-input bg-surface-muted p-4">
            <div><div className="text-small text-ink-muted">You convert</div><div className="text-h2 tabular">{moneyText(s.you_sell)}</div></div>
            <div className="text-right"><div className="text-small text-ink-muted">You get</div><div className="text-h2 tabular">{moneyText(s.you_get)}</div></div>
          </div>
          <div className="mt-2">
            <KeyValue label="Our rate" value={s.rate} />
            <KeyValue label="Mid-market rate" value={s.mid_rate} />
            <KeyValue label="Cost vs mid-market" value={moneyText(s.cost_vs_mid)} />
            {s.trigger && <KeyValue label="Why now" value={s.trigger} />}
          </div>
        </>
      )}
      {action.kind === "add_beneficiary" && (
        <div className="mt-2">
          <KeyValue label="Name" value={s.recipient} />
          <KeyValue label="Bank" value={s.bank} />
          <KeyValue label="Account" value={s.account} />
          {s.cooling_off && <Note tone="warning" className="mt-3">{s.cooling_off}</Note>}
        </div>
      )}

      {(action.policy_reasons?.length > 0 || action.risk_reasons?.length > 0) && (
        <Disclosure summary={blocked ? "Why it was blocked" : "Why this level of check"} defaultOpen={blocked}>
          <ul className="space-y-2 text-small">
            {action.policy_reasons?.map((r) => <li key={r} className={cx("flex gap-2", blocked && "text-danger")}><span aria-hidden>•</span>{r}</li>)}
            {action.risk_reasons?.map((r) => <li key={r.rule} className="flex gap-2 text-ink-muted"><span aria-hidden>•</span>{r.reason}</li>)}
          </ul>
          <p className="mt-3 text-caption text-ink-muted">Risk score {action.risk_score} out of 100, calculated by fixed rules, not by the AI.</p>
        </Disclosure>
      )}

      {error && <Note tone="danger" className="mt-4">{error}</Note>}

      {action.status === "awaiting_confirmation" && !expired && token && (
        <div className="mt-5 space-y-3">
          {action.requires_step_up && <Note tone="warning" icon={<KeyRound className="h-4 w-4" />}>This one needs an extra check. After you approve, enter the code we send to your phone.</Note>}
          <div className="flex gap-3">
            <Button className="flex-1" onClick={confirm} loading={busy} data-testid="confirm-btn">{CONFIRM_LABEL[action.kind] ?? "Confirm"}</Button>
            <Button variant="secondary" onClick={cancel} disabled={busy}>Cancel</Button>
          </div>
          <p className="text-caption text-ink-muted">This approval works once for exactly these details and expires in <span className="tabular">{countdown(action.expires_at, nowMs)}</span>. Remi can't see or use it.</p>
        </div>
      )}
      {(action.status === "awaiting_confirmation" || expired) && !(token && !expired) && (
        <div className="mt-5 flex gap-3">
          <Button className="flex-1" variant="secondary" onClick={reissue} loading={busy} data-testid="reissue-btn">{expired ? "Check again and approve" : "Review and approve"}</Button>
          {!expired && <Button variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button>}
        </div>
      )}

      {action.status === "awaiting_step_up" && (
        <div className="mt-5 rounded-input bg-surface-muted p-4">
          <div className="flex items-center gap-2 text-body-strong"><Smartphone className="h-5 w-5" /> Enter the 6-digit code</div>
          <p className="mt-1 text-small text-ink-muted">We sent it to your phone. It expires in 3 minutes.</p>
          <div className="mt-3 flex gap-3">
            <input
              data-testid="otp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              aria-label="One-time code"
              className="h-12 w-40 rounded-input border border-line bg-surface text-center text-h2 tracking-widest tabular focus:border-primary focus:outline-none"
            />
            <Button onClick={stepUp} loading={busy} disabled={code.length !== 6} data-testid="verify-btn">Verify</Button>
            <Button variant="ghost" onClick={cancel} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}

      {action.status === "scheduled" && (
        <Note tone="warning" className="mt-5">New recipient waiting period. It sends automatically in <span className="tabular font-semibold">{countdown(action.not_before, nowMs)}</span>. You can still cancel.</Note>
      )}

      {action.status === "executed" && action.kind === "payment" && receipt && <Tracking receipt={receipt} status={transferStatus} />}
      {action.status === "executed" && action.kind === "fx_conversion" && (
        <Note tone="success" className="mt-5">Converted. You got {moneyText(action.result?.bought)} for {moneyText(action.result?.sold)}.</Note>
      )}
      {action.status === "executed" && action.kind === "add_beneficiary" && (
        <Note tone="success" className="mt-5">Recipient added. You can pay them after the waiting period ({shortDate(action.result?.active_after)}).</Note>
      )}
      {(action.status === "cancelled" || action.status === "failed") && (
        <p className="mt-4 text-small text-ink-muted">{action.status === "failed" ? "It didn't go through." : "Cancelled."} Nothing moved.</p>
      )}
      {blocked && <p className="mt-4 flex items-center gap-2 text-small text-danger"><ShieldAlert className="h-4 w-4" /> Nothing moved. Remi will not retry this.</p>}
    </Card>
  );
}

function Tracking({ receipt, status }: { receipt: Record<string, any>; status?: string }) {
  const current = Math.max(0, TRACK.findIndex((t) => t.key === status));
  const download = () => {
    const lines = [
      "Remi receipt (sandbox, no real money)", `Reference: ${receipt.reference}`, `Sent: ${moneyText(receipt.sent)}`, `Received: ${moneyText(receipt.received)}`,
      `Fee: ${moneyText(receipt.fee)}`, `Expected arrival: ${shortDate(receipt.expected_arrival)}`, `Status: ${TRANSFER_STATUS[status ?? "pending"]?.label ?? status}`, receipt.disclaimer ?? "",
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${receipt.reference}.txt` });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div data-testid="receipt" data-transfer-status={status} className="mt-5 rounded-input bg-surface-muted p-4">
      <Timeline steps={TRACK} current={current} testId="tracking" />
      <div className="mt-4 border-t border-line pt-2">
        <KeyValue label="Reference" value={receipt.reference} />
        <KeyValue label="Received" value={moneyText(receipt.received)} />
        <KeyValue label="Expected" value={shortDate(receipt.expected_arrival)} />
      </div>
      <Button variant="ghost" size="sm" icon={<Download className="h-4 w-4" />} onClick={download} className="-ml-2 mt-1">Download receipt</Button>
    </div>
  );
}
