import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, User } from "lucide-react";
import { QuoteCard } from "../cards/QuoteCard";
import { api } from "../lib/api";
import { date, money } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import { AmountInput, Badge, Button, Card, EmptyState, ErrorState, Field, Input, ListRow, Note, PageHeader, RowIcon, Select, Skeleton, SkeletonRows, Tabs } from "../ui";

type Mode = "send" | "receive";

export default function Send() {
  const { askRemi } = useStore();
  const bens = useApi<any[]>("/beneficiaries");
  const wallets = useApi<any>("/wallets");
  const invoices = useApi<any[]>("/invoices");
  const [tab, setTab] = useState<"send" | "recipients">("send");
  const [recipient, setRecipient] = useState("");
  const [mode, setMode] = useState<Mode>("receive");
  const [sendAmount, setSendAmount] = useState("");
  const [receiveAmount, setReceiveAmount] = useState("");
  const [sendCcy, setSendCcy] = useState<string | null>(null);
  const [deadline, setDeadline] = useState("");
  const [quote, setQuote] = useState<any>(null);
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  const selected = bens.data?.find((b) => b.id === recipient);
  const invoice = invoices.data?.[0];
  const isTuition = selected?.kind === "university";

  useEffect(() => {
    if (bens.data && !recipient) {
      const uni = bens.data.find((b) => b.kind === "university") ?? bens.data[0];
      if (uni) setRecipient(uni.id);
    }
  }, [bens.data, recipient]);

  // Picking a recipient resets the calculator; tuition pre-fills the invoice amount.
  useEffect(() => {
    if (!selected) return;
    setQuote(null);
    setSendCcy(null);
    setSendAmount("");
    setMode("receive");
    setReceiveAmount(selected.kind === "university" && invoice ? String(Number(invoice.amount)) : "");
  }, [selected?.id, invoice?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const amount = mode === "receive" ? receiveAmount : sendAmount;
  useEffect(() => {
    if (!recipient || !amount || Number(amount) <= 0) {
      setQuote(null);
      return;
    }
    const id = ++seq.current;
    setQuoting(true);
    const t = window.setTimeout(async () => {
      try {
        const q = await api.post<any>("/quotes", { recipient, amount, amount_mode: mode, send_currency: sendCcy ?? undefined, deadline: deadline || undefined });
        if (id !== seq.current) return;
        setQuote(q);
        setErr(null);
        const best = q.recommended ?? q.options?.[0] ?? q.rejected?.[0];
        if (best) {
          if (mode === "receive") setSendAmount(String(Number(best.send_amount)));
          else setReceiveAmount(String(Number(best.receive_amount)));
          if (!sendCcy) setSendCcy(best.send_currency);
        }
      } catch (e: any) {
        if (id === seq.current) setErr(e.message);
      } finally {
        if (id === seq.current) setQuoting(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [recipient, amount, mode, sendCcy, deadline]);

  const currencies = useMemo(() => (wallets.data?.wallets ?? []).map((w: any) => w.currency), [wallets.data]);
  const recvCcy = selected?.currency ?? "";
  const shownSendCcy = sendCcy ?? quote?.recommended?.send_currency ?? currencies[0] ?? "";
  const canReview = !!selected && !!quote?.recommended && selected.active !== false;

  const review = () => {
    if (!selected) return;
    if (isTuition) {
      askRemi(`Pay my ${money(receiveAmount, recvCcy, { whole: Number(receiveAmount) % 1 === 0 })} tuition before the deadline, cheapest safe way`);
      return;
    }
    const who = selected.nickname ? `my ${selected.nickname}` : selected.name;
    const [amt, ccy] = mode === "receive" ? [receiveAmount, recvCcy] : [sendAmount, shownSendCcy];
    askRemi(`Send ${Number(amt).toLocaleString("en-GB")} ${ccy} to ${who}`);
  };

  return (
    <div className="mx-auto max-w-[600px]">
      <PageHeader title="Send" description="Pay tuition or send money home. Remi finds the cheapest way that arrives on time." />
      <Tabs value={tab} onChange={setTab} items={[{ value: "send", label: "Send money", testId: "tab-send-money" }, { value: "recipients", label: "Recipients", testId: "tab-recipients" }]} className="mb-6" />

      {tab === "send" && (
        <div className="space-y-6">
          {bens.error && <ErrorState message={bens.error} onRetry={bens.reload} />}
          {!bens.data ? <Skeleton className="h-80" /> : (
            <Card className="space-y-4">
              <Field label="To">
                <Select data-testid="t-recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                  {bens.data.map((b) => <option key={b.id} value={b.id}>{b.name}{b.nickname && b.nickname !== b.kind ? ` · ${b.nickname[0].toUpperCase()}${b.nickname.slice(1)}` : ""}</option>)}
                </Select>
              </Field>
              <AmountInput label="You send" testId="t-send-amount" value={sendAmount} onChange={(v) => { setMode("send"); setSendAmount(v); }} currency={shownSendCcy} currencies={currencies} onCurrency={(c) => { setSendCcy(c); }} loading={quoting && mode === "receive"} />
              <AmountInput label={isTuition ? "University receives" : "They receive"} testId="t-amount" value={receiveAmount} onChange={(v) => { setMode("receive"); setReceiveAmount(v); }} currency={recvCcy} loading={quoting && mode === "send"} />
              <Field label="Needed by (optional)" hint={isTuition && invoice ? `Your invoice is due ${date(invoice.due_date)}.` : undefined}>
                <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </Field>
              {selected && selected.active === false && <Note tone="warning">New recipient: payments unlock after the waiting period ({date(selected.active_after)}).</Note>}
            </Card>
          )}

          {err && <Note tone="danger">{err}</Note>}
          {quote ? <QuoteCard data={quote} /> : bens.data && <EmptyState title="Enter an amount to see the best option." />}

          <div className="space-y-3">
            <Button block disabled={!canReview || quoting} onClick={review} data-testid="t-review">Review</Button>
            <p className="text-center text-small text-ink-muted">Remi prepares it for your approval. Nothing is sent until you confirm.</p>
          </div>
        </div>
      )}

      {tab === "recipients" && (
        <Card className="py-3">
          {!bens.data ? <div className="py-3"><SkeletonRows rows={4} /></div> : (
            <div className="divide-y divide-line">
              {bens.data.map((b) => (
                <ListRow
                  key={b.id}
                  onClick={() => { setRecipient(b.id); setTab("send"); }}
                  leading={<RowIcon>{b.kind === "university" ? <Building2 className="h-5 w-5" /> : <User className="h-5 w-5" />}</RowIcon>}
                  title={b.name}
                  subtitle={`${b.nickname && b.nickname !== b.kind ? `${b.nickname[0].toUpperCase()}${b.nickname.slice(1)} · ` : ""}${b.bank_name} ${b.account}`}
                  trailing={b.registry_verified ? <Badge tone="success">Verified university</Badge> : !b.active ? <Badge tone="warning">Waiting period</Badge> : <Badge>{b.currency}</Badge>}
                />
              ))}
            </div>
          )}
          <div className="border-t border-line pt-4">
            <Button variant="ghost" size="sm" className="-ml-2" onClick={() => askRemi("I want to add a new recipient", { autoSend: false })}>Add a recipient with Remi</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
