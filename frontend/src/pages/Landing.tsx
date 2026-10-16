import { useEffect, useState } from "react";
import { ArrowRight, BadgeCheck, CircleCheck, Eye, HandCoins, KeyRound, Lock } from "lucide-react";
import { whyNot } from "../cards/QuoteCard";
import { api } from "../lib/api";
import { money, shortDate } from "../lib/format";
import { useStore } from "../lib/store";
import { Button, Flag, Skeleton, useCountUp, Wordmark } from "../ui";

const PERSONAS = [
  { id: "rahim", name: "Rahim", from: "BD", to: "GB", line: "Bangladesh → UK", who: "Master's student paying £9,250 tuition" },
  { id: "ada", name: "Ada", from: "NG", to: "CA", line: "Nigeria → Canada", who: "Undergraduate sending money to her mum" },
  { id: "priya", name: "Priya", from: "IN", to: "US", line: "India → US", who: "PhD student on a stipend" },
];

export default function Landing() {
  const { navigate, setSession, session } = useStore();
  const [starting, setStarting] = useState<string | null>(null);
  const start = async (persona?: string) => {
    if (persona && persona !== session?.persona) {
      setStarting(persona);
      try {
        setSession(await api.post<any>("/session/persona", { persona }));
      } finally {
        setStarting(null);
      }
    }
    navigate("home");
  };
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg">
        <div className="mx-auto flex h-18 max-w-[1120px] items-center gap-8 px-4 py-4 md:px-8">
          <Wordmark height={30} />
          <nav className="hidden items-center gap-6 md:flex">
            <button onClick={() => scrollTo("how")} className="text-small font-semibold text-ink-muted hover:text-ink">How it works</button>
            <button onClick={() => scrollTo("control")} className="text-small font-semibold text-ink-muted hover:text-ink">Security</button>
          </nav>
          <Button size="sm" className="ml-auto" onClick={() => start()} data-testid="landing-cta">Try the live demo</Button>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1120px] items-center gap-12 px-4 pb-20 pt-16 md:px-8 md:pt-24 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <span className="inline-flex h-8 items-center gap-2 rounded-full bg-surface-muted px-4 text-caption text-ink-muted"><span className="h-2 w-2 rounded-full bg-accent" />Sandbox demo for international students</span>
            <h1 className="mt-6 text-display">Money across borders, handled.</h1>
            <p className="mt-6 max-w-xl text-body text-ink-muted">Remi finds the cheapest way to pay tuition and send money home, prepares the payment, and waits for your approval. You stay in control of every penny.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button onClick={() => start()} icon={<ArrowRight className="h-5 w-5" />} className="flex-row-reverse">Try the live demo</Button>
              <Button variant="secondary" onClick={() => scrollTo("how")}>See how it works</Button>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-small text-ink-muted">
              {["No real money", "You approve every payment", "Every step logged"].map((t) => <li key={t} className="flex items-center gap-2"><CircleCheck className="h-4 w-4 text-success" />{t}</li>)}
            </ul>
          </div>
          <LiveQuote />
        </section>

        <section id="how" className="bg-primary text-on-primary">
          <div className="mx-auto max-w-[1120px] px-4 py-20 md:px-8 md:py-28">
            <h2 className="max-w-2xl text-h1">An assistant that actually does the work.</h2>
            <p className="mt-4 max-w-2xl text-body opacity-80">Not just answers. Remi plans the payment, prepares it, and tracks it until it arrives.</p>
            <ol className="mt-14 grid gap-10 md:grid-cols-3">
              {[
                ["Ask", "Say what you need in your own words: pay tuition, send money home, or check how long your money lasts."],
                ["Review", "Remi compares four providers on total cost and your deadline, then explains its pick in plain words."],
                ["Approve and track", "Nothing moves until you approve. Then watch it go from sent to arrived, live."],
              ].map(([title, body], i) => (
                <li key={title} className="border-t border-primary-soft/30 pt-6">
                  <div className="flex items-baseline gap-1 text-h1"><span>{i + 1}</span><span className="h-2.5 w-2.5 rounded-full bg-accent" /></div>
                  <h3 className="mt-4 text-h2">{title}</h3>
                  <p className="mt-2 text-body opacity-80">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="control" className="bg-primary-soft">
          <div className="mx-auto grid max-w-[1120px] gap-12 px-4 py-20 md:px-8 md:py-28 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="text-h1">You stay in control.</h2>
              <p className="mt-4 max-w-md text-body">Fixed rules, not the AI, decide what Remi may do. Moving money always needs you, and the riskiest steps need a one-time code too.</p>
              <p className="mt-6 flex items-center gap-2 text-body-strong"><BadgeCheck className="h-5 w-5" />Every action is logged and tamper-evident.</p>
            </div>
            <ul className="space-y-3">
              {[
                [Eye, "Looks things up", "Automatic"],
                [HandCoins, "Moves money", "Needs your approval"],
                [KeyRound, "New recipients and large amounts", "Approval + code + waiting period"],
                [Lock, "Your limits and the activity log", "Remi can never change them"],
              ].map(([Icon, what, how]: any) => (
                <li key={what} className="flex items-center gap-4 rounded-card bg-surface p-5">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-on-primary"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-strong">{what}</span>
                    <span className="block text-small text-ink-muted sm:hidden">{how}</span>
                  </span>
                  <span className="hidden text-right text-small text-ink-muted sm:block">{how}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-[1120px] px-4 py-20 md:px-8 md:py-28">
          <h2 className="text-h1">Try it as a student.</h2>
          <p className="mt-3 text-body text-ink-muted">Three fictional students, each with their own wallets, bills and deadlines.</p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PERSONAS.map((p) => (
              <button key={p.id} onClick={() => start(p.id)} data-testid={`try-${p.id}`} className="group flex flex-col rounded-card border border-line bg-surface p-6 text-left transition-colors hover:border-primary">
                <div className="flex items-center">
                  <Flag country={p.from} size={40} />
                  <Flag country={p.to} size={40} className="-ml-2 ring-4 ring-surface" />
                </div>
                <div className="mt-6 text-h2">{p.name}</div>
                <div className="text-body-strong text-ink-muted">{p.line}</div>
                <p className="mt-2 flex-1 text-small text-ink-muted">{p.who}</p>
                <span className="mt-6 inline-flex items-center gap-2 text-small font-semibold text-primary">
                  {starting === p.id ? "Opening…" : `Start as ${p.name}`} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-4 py-12 md:flex-row md:items-end md:justify-between md:px-8">
          <div>
            <Wordmark height={28} />
            <p className="mt-4 text-small text-ink-muted">Team Git Push Pray · FinTechathon 2026 · Topic C</p>
            <p className="mt-1 text-small text-ink-muted">Sandbox demo. Not financial, legal or tax advice. All banks, providers and universities are fictional.</p>
          </div>
          <a href="https://github.com/sakib-101-git/remi" target="_blank" rel="noreferrer" className="text-small font-semibold text-primary underline-offset-4 hover:underline">Source on GitHub</a>
        </div>
      </footer>
    </div>
  );
}

/** A real quote from the visitor's sandbox: tuition to the verified university, cheapest safe way. */
function LiveQuote() {
  const [q, setQ] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const [bens, invs] = await Promise.all([api.get<any[]>("/beneficiaries"), api.get<any[]>("/invoices")]);
        const uni = bens.find((b) => b.kind === "university");
        if (!uni) throw new Error("no university");
        const amount = invs[0]?.amount ?? "9250";
        setQ(await api.post("/quotes", { recipient: uni.id, amount: String(amount), amount_mode: "receive" }));
      } catch {
        setFailed(true);
      }
    })();
  }, []);
  const best = q?.recommended;
  const send = useCountUp(Number(best?.send_amount ?? 0), 1100);
  const saving = q?.explanation?.alternatives?.find((a: any) => /Costs/.test(a.why_not));
  if (failed) return null;
  return (
    <div className="relative mx-auto w-full max-w-[460px]" data-testid="live-quote">
      <div aria-hidden className="absolute -right-2 -top-2 h-full w-full rounded-card bg-primary-soft md:-right-4 md:-top-4" />
      <div className="relative rounded-card border border-line bg-surface p-6 md:p-8">
        <div className="flex items-center justify-between">
          <span className="text-small text-ink-muted">Tuition payment</span>
          <span className="inline-flex items-center gap-2 text-caption text-success"><span className="h-2 w-2 animate-pulse-dot rounded-full bg-success" />Live sandbox quote</span>
        </div>
        {!best ? <Skeleton className="mt-6 h-64" /> : (
          <>
            <div className="mt-6 rounded-input bg-surface-muted p-4">
              <div className="text-small text-ink-muted">You send</div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-h1 tabular">{money(send, best.send_currency, { whole: true })}</span>
                <span className="flex items-center gap-2 text-body-strong"><Flag currency={best.send_currency} size={28} />{best.send_currency}</span>
              </div>
            </div>
            <div className="px-4 py-3 text-small text-ink-muted">{best.rate_display} · total cost {money(best.landed_cost, best.send_currency, { whole: true })}</div>
            <div className="rounded-input bg-surface-muted p-4">
              <div className="text-small text-ink-muted">University receives</div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-h1 tabular">{money(best.receive_amount, best.receive_currency, { whole: true })}</span>
                <span className="flex items-center gap-2 text-body-strong"><Flag currency={best.receive_currency} size={28} />{best.receive_currency}</span>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-3 text-body">
              <CircleCheck className="h-5 w-5 text-success" />
              <span>Arrives by <span className="font-semibold">{shortDate(best.arrival_latest)}</span> with {best.provider_name.replace(" (sandbox)", "")}</span>
            </div>
            {saving && (
              <div className="mt-3 flex items-center gap-3 text-small text-ink-muted">
                <span className="ml-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
                Cheapest of 4 providers · the next best {whyNot(saving.why_not).toLowerCase()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
