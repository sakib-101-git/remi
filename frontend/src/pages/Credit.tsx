import { useState } from "react";
import { Check, Lock } from "lucide-react";
import { api } from "../lib/api";
import { COUNTRY_NAME, cx } from "../lib/format";
import { useApi, useStore } from "../lib/store";
import { Badge, Button, Card, CardHeader, ErrorState, PageHeader, Ring, Skeleton, TextLink } from "../ui";

export default function Credit() {
  const { data, error, reload } = useApi<any>("/credit");
  const { pushToast, session } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const country = COUNTRY_NAME[session?.user.host_country ?? ""] ?? "your new country";
  const header = <PageHeader title="Credit" description={`Build a credit history in ${country}, one step at a time.`} />;
  if (error) return <>{header}<ErrorState message={error} onRetry={reload} /></>;
  if (!data) return <>{header}<Skeleton className="h-96" /></>;

  const setStatus = async (key: string, status: string) => {
    setBusy(key);
    try {
      if (!data.saved) await api.post("/credit/create");
      await api.post(`/credit/tasks/${key}`, { status });
      reload();
    } catch (e: any) {
      pushToast({ kind: "blocked", title: "Can't do that step yet", body: e.message });
    } finally {
      setBusy(null);
    }
  };

  const tasks: any[] = data.tasks ?? [];
  const done = tasks.filter((t) => t.status === "done");
  const remaining = tasks.filter((t) => t.status !== "done");
  const next = data.next_steps?.[0];
  const meaning = data.readiness_score >= 70 ? "You're ready to apply for most everyday credit." : data.readiness_score >= 30 ? "You're building a solid base. Keep going." : "Most new arrivals start here. The first steps take a few weeks.";

  return (
    <div>
      {header}
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-6">
          <Card className="flex items-center gap-6" data-testid="credit-readiness">
            <Ring value={data.readiness_score} size={112} label={`Credit readiness ${data.readiness_score} out of 100`} />
            <div>
              <div className="text-small text-ink-muted">Credit readiness</div>
              <div className="text-h2">{data.readiness_label}</div>
              <p className="mt-1 text-small text-ink-muted">{meaning}</p>
            </div>
          </Card>
          {next && (
            <Card tone="mint" data-testid="credit-next">
              <div className="text-small text-ink-muted">Your next step</div>
              <h2 className="mt-1 text-h2">{next.title}</h2>
              <p className="mt-2 text-small">{next.description}</p>
              <Button className="mt-5" size="sm" loading={busy === next.task_key} onClick={() => setStatus(next.task_key, "done")} data-testid="credit-mark-done">Mark as done</Button>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader title="Your 6-month plan" description={`${done.length} of ${tasks.length} steps done`} action={done.length > 0 ? <TextLink onClick={() => setShowDone((v) => !v)}>{showDone ? "Hide done" : "Show done"}</TextLink> : undefined} />
          <ol className="relative space-y-1">
            {(showDone ? tasks : remaining).map((t) => {
              const isDone = t.status === "done";
              const locked = !t.unlocked && !isDone;
              return (
                <li key={t.task_key} className="flex gap-4 rounded-input py-3">
                  <button
                    disabled={locked || busy === t.task_key}
                    onClick={() => setStatus(t.task_key, isDone ? "todo" : "done")}
                    aria-label={isDone ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`}
                    className={cx("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition-colors", isDone ? "border-success bg-success text-on-primary" : locked ? "border-line text-ink-muted" : "border-primary hover:bg-primary-soft")}
                  >
                    {isDone ? <Check className="h-4 w-4" /> : locked ? <Lock className="h-3.5 w-3.5" /> : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cx("text-body-strong", isDone && "text-ink-muted line-through")}>{t.title}</span>
                      <Badge>Month {t.month}</Badge>
                    </div>
                    <p className="text-small text-ink-muted">{locked ? "Unlocks after the steps before it." : t.description}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 border-t border-line pt-4 text-caption text-ink-muted">Illustrative steps. Check official sources. The readiness score is a planning aid, not a real credit score.</p>
        </Card>
      </div>
    </div>
  );
}
