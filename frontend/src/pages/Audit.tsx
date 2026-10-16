import { useState } from "react";
import { Download, Link2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { useApi } from "../lib/store";
import { Badge, Button, Card, ErrorNote, Skeleton, TierBadge } from "../components/ui";

const ACTOR_TONE: Record<string, any> = { user: "info", agent: "brand", system: "neutral" };

export default function Audit() {
  const { data, error, reload } = useApi<any>("/audit?limit=200");
  const [verifying, setVerifying] = useState(false);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<number | null>(null);
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const v = data?.verification;
  const rows = (data?.entries ?? []).filter((e: any) => filter === "all" || e.actor === filter || (filter === "money" && ["T2", "T3", "T4"].includes(e.tier)));
  const verify = async () => {
    setVerifying(true);
    await api.get("/audit/verify");
    reload();
    window.setTimeout(() => setVerifying(false), 400);
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-muted text-sm">Append-only. Each entry stores the SHA-256 hash of the previous one, so any edit, deletion or re-ordering breaks the chain.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={verify} loading={verifying}><RefreshCw className="h-4 w-4" /> Verify chain</Button>
          <a href="/api/audit/export" className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl border border-soft px-4 text-sm font-medium hover:border-brand-400"><Download className="h-4 w-4" /> Export JSON</a>
        </div>
      </div>
      {!v ? <Skeleton className="h-20" /> : (
        <Card className={cx(v.valid ? "border-emerald-500/40 bg-emerald-500/[0.04]" : "border-rose-500/50 bg-rose-500/5")}>
          <div data-testid="chain-status" className="flex items-center gap-4">
            <div className={cx("grid h-12 w-12 place-items-center rounded-2xl", v.valid ? "bg-emerald-500/15 text-emerald-600" : "bg-rose-500/15 text-rose-600")}>{v.valid ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}</div>
            <div className="flex-1">
              <div className="font-display text-lg font-semibold">{v.valid ? "Chain verified" : `Chain broken at entry #${v.broken_at}`}</div>
              <div className="text-muted text-sm">{v.entries} entries · {v.valid ? <>head <span className="font-mono text-xs">{String(v.head).slice(0, 24)}…</span></> : v.reason}</div>
            </div>
          </div>
        </Card>
      )}
      <Card pad={false}>
        <div className="flex flex-wrap gap-1.5 border-b border-soft p-3">
          {["all", "user", "agent", "system", "money"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cx("rounded-lg px-2.5 py-1 text-xs font-medium capitalize", filter === f ? "bg-brand-500/10 text-brand-700 dark:text-brand-300" : "text-muted hover:bg-black/5 dark:hover:bg-white/5")}>{f === "money" ? "T2–T4 only" : f}</button>
          ))}
        </div>
        {!data ? <Skeleton className="m-4 h-64" /> : (
          <div className="divide-y divide-[var(--border)]">
            {rows.map((e: any) => (
              <div key={e.seq} className="px-4 py-2.5">
                <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === e.seq ? null : e.seq)}>
                  <span className="text-muted num w-10 shrink-0 font-mono text-xs">#{e.seq}</span>
                  <Badge tone={ACTOR_TONE[e.actor]}>{e.actor}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.action}{e.tool ? <span className="text-muted ml-1.5 font-mono text-xs">{e.tool}</span> : null}</span>
                  {e.tier && <TierBadge tier={e.tier} short />}
                  {e.decision && <span className="text-muted hidden text-xs sm:inline">{e.decision}</span>}
                  <span className="text-muted hidden font-mono text-[10px] md:inline"><Link2 className="mr-0.5 inline h-3 w-3" />{e.hash.slice(0, 10)}</span>
                </button>
                {open === e.seq && (
                  <div className="panel-2 mt-2 space-y-1 rounded-xl p-3 font-mono text-[11px]">
                    <div><span className="text-muted">ts</span> {e.ts}</div>
                    <div className="break-all"><span className="text-muted">prev_hash</span> {e.prev_hash}</div>
                    <div className="break-all"><span className="text-muted">hash</span> {e.hash}</div>
                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap">{JSON.stringify({ inputs: e.inputs, result: e.result }, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
