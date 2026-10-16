import { useState } from "react";
import { ArrowUp, BellRing, CalendarClock, ShieldCheck } from "lucide-react";
import { ActionCard } from "../cards/ActionCard";
import { TxnRow } from "../app/TxnRow";
import { CURRENCY_NAME, firstName, greeting, money, moneyText, relative } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import { Badge, Button, Card, ErrorState, Flag, Section, Sheet, Skeleton, SkeletonRows, TextLink, useCountUp, useTitleRef } from "../ui";

export default function Home() {
  const { session, askRemi, navigate, tokenCards } = useStore();
  const { data, error, reload } = useApi<any>("/dashboard");
  const titleRef = useTitleRef();
  const [review, setReview] = useState<any>(null);
  const w = data?.wallets;
  const ccy = w?.reporting_currency ?? session?.user.reporting_currency ?? "GBP";
  const total = useCountUp(Number(w?.total_in_reporting_currency ?? 0));
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const tuition = data?.obligations?.find((o: any) => o.kind === "tuition");
  const upNext: { key: string; node: React.ReactNode }[] = [];
  for (const a of data?.open_actions ?? []) {
    upNext.push({
      key: a.id,
      node: (
        <UpNextCard
          icon={<ShieldCheck className="h-5 w-5" />}
          badge={<Badge tone="warning">Needs your approval</Badge>}
          title={a.summary?.title ?? "Waiting for your approval"}
          body={a.kind === "fx_conversion" ? `Convert ${moneyText(a.summary?.you_sell)} into ${moneyText(a.summary?.you_get)}` : a.summary?.they_receive ? `They receive ${moneyText(a.summary.they_receive)}` : undefined}
          action={<Button size="sm" onClick={() => setReview(tokenCards[a.id] ? { ...a, confirm_token: tokenCards[a.id].confirm_token } : a)} data-testid="review-approval">Review</Button>}
        />
      ),
    });
  }
  if (tuition) {
    upNext.push({
      key: "tuition",
      node: (
        <UpNextCard
          icon={<CalendarClock className="h-5 w-5" />}
          badge={<Badge tone={tuition.days_left <= 14 ? "accent" : "neutral"}>Due {relative(tuition.days_left)}</Badge>}
          title={`Tuition ${money(tuition.amount, tuition.currency, { whole: true })}`}
          body={tuition.title.split(" — ")[1] ?? tuition.title}
          action={<Button size="sm" data-testid="pay-tuition" onClick={() => askRemi(`Pay my ${money(tuition.amount, tuition.currency, { whole: true })} tuition before the deadline, cheapest safe way`)}>Plan it</Button>}
        />
      ),
    });
  }
  const alert = data?.alerts?.find((a: any) => a.status === "active");
  if (alert) {
    upNext.push({
      key: alert.id,
      node: <UpNextCard icon={<BellRing className="h-5 w-5" />} badge={<Badge tone="primary">Watching</Badge>} title={`${alert.pair} ${alert.direction} ${alert.target_rate}`} body={alert.convert_amount ? `Then Remi prepares a ${alert.convert_amount} ${alert.convert_currency} conversion` : "You'll get a notification"} />,
    });
  }

  const bill = data?.obligations?.find((o: any) => o.kind !== "tuition" && o.days_left >= 0);
  if (bill) {
    const payee = bill.kind === "rent" ? "my landlord" : null;
    upNext.push({
      key: bill.id,
      node: (
        <UpNextCard
          icon={<CalendarClock className="h-5 w-5" />}
          badge={<Badge tone={bill.days_left <= 7 ? "accent" : "neutral"}>Due {relative(bill.days_left)}</Badge>}
          title={`${bill.title.split(" — ")[0]} ${money(bill.amount, bill.currency, { whole: true })}`}
          body={bill.title.split(" — ")[1] ?? (bill.recurring ? "Every month" : undefined)}
          action={payee ? <Button size="sm" variant="secondary" onClick={() => askRemi(`Pay my rent of ${money(bill.amount, bill.currency, { whole: true })} to ${payee}`)}>Pay it</Button> : undefined}
        />
      ),
    });
  }
  return (
    <div className="space-y-12">
      <section className="grid gap-6 overflow-hidden rounded-card bg-primary p-6 text-on-primary md:p-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
        <div className="min-w-0">
          <h1 ref={titleRef} className="text-h1">{greeting(session?.sim_now)}, {firstName(session?.user.name)}</h1>
          <div className="mt-8 text-small opacity-80">Total balance</div>
          {w ? <div data-testid="total-balance" className="text-amount-xl">{money(total, ccy, { whole: true })}</div> : <Skeleton className="mt-2 h-11 w-56 opacity-30" />}
          {data && (
            <div className="mt-2 flex items-center gap-2 text-small">
              <span className="h-2.5 w-2.5 rounded-full bg-accent" />
              Available to spend: <span className="font-semibold tabular">{money(data.runway.available_after_obligations, ccy, { whole: true })}</span>
            </div>
          )}
        </div>
        <AskBox />
      </section>

      {upNext.length > 0 && (
        <Section title="Up next">
          <div className="grid gap-6 md:grid-cols-2">{upNext.slice(0, 2).map((u) => <div key={u.key}>{u.node}</div>)}</div>
        </Section>
      )}

      <Section title="Wallets" action={<TextLink onClick={() => navigate("wallets")}>See all</TextLink>}>
        {!w ? <Skeleton className="h-28" /> : (
          <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:px-0">
            {w.wallets.map((x: any) => (
              <button key={x.currency} onClick={() => navigate("wallets", x.currency)} className="min-w-52 rounded-card border border-line bg-surface p-5 text-left transition-colors hover:border-primary">
                <div className="flex items-center gap-3"><Flag currency={x.currency} size={32} /><span className="text-body-strong">{x.currency}</span></div>
                <div className="mt-4 text-h2 tabular">{money(x.balance, x.currency, { whole: true })}</div>
                <div className="text-small text-ink-muted tabular">{x.currency === ccy ? CURRENCY_NAME[x.currency] : `≈ ${money(x.in_reporting_currency, ccy, { whole: true })}`}</div>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent activity" action={<TextLink onClick={() => navigate("wallets")}>See all</TextLink>}>
        <Card className="py-3">{!data ? <div className="py-3"><SkeletonRows rows={5} /></div> : <div className="divide-y divide-line">{data.recent.slice(0, 5).map((t: any) => <TxnRow key={t.id} t={t} />)}</div>}</Card>
      </Section>

      <Sheet open={!!review} onClose={() => setReview(null)} title="Review" subtitle="Check the details, then approve">
        <div className="p-4">{review && <ActionCard key={review.id + (review.confirm_token ? "t" : "")} initial={review} />}</div>
      </Sheet>
    </div>
  );
}

function UpNextCard({ icon, badge, title, body, action }: { icon: React.ReactNode; badge: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <Card className="flex h-full flex-col gap-4" data-testid="upnext-card">
      <div className="flex items-center justify-between gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-muted">{icon}</span>
        {badge}
      </div>
      <div className="flex-1">
        <div className="text-h2">{title}</div>
        {body && <p className="mt-1 text-small text-ink-muted">{body}</p>}
      </div>
      {action && <div>{action}</div>}
    </Card>
  );
}

/** The large "Ask Remi" composer on Home: opens the chat panel and sends. */
function AskBox() {
  const { askRemi, session } = useStore();
  const [text, setText] = useState("");
  const chips = [
    { label: "Pay my tuition", prompt: "Pay my tuition before the deadline, cheapest safe way" },
    { label: "How long will my money last?", prompt: "How am I doing this month? How long will my money last?" },
    { label: "Send money home", prompt: session?.persona === "ada" ? "Send 150,000 NGN to my mum" : session?.persona === "priya" ? "Send 20,000 INR to my mom" : "Send 15,000 BDT to my mom" },
  ];
  const go = (p: string) => p.trim() && askRemi(p.trim());
  return (
    <div className="min-w-0 rounded-card bg-surface p-4 text-ink">
      <form onSubmit={(e) => { e.preventDefault(); go(text); setText(""); }} className="flex items-center gap-2 rounded-full border border-line pl-5 pr-1.5 focus-within:border-primary">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Remi anything about your money" aria-label="Ask Remi" data-testid="home-ask" className="h-12 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-ink-muted focus-visible:outline-none" />
        <button type="submit" aria-label="Ask" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-on-primary"><ArrowUp className="h-5 w-5" /></button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((c) => <button key={c.label} onClick={() => go(c.prompt)} className="h-9 rounded-full bg-surface-muted px-4 text-small transition-colors hover:bg-primary-soft">{c.label}</button>)}
      </div>
    </div>
  );
}
