import { api } from "../lib/api";
import { useApi, useStore } from "../lib/store";
import { CreditPlanCard } from "../components/cards/InsightCards";
import { Button, Card, ErrorNote, Skeleton } from "../components/ui";

export default function Credit() {
  const { data, error, reload } = useApi<any>("/credit");
  const { pushToast, askRemi, session } = useStore();
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return <Skeleton className="h-96" />;
  const toggle = async (key: string, status: string) => {
    try {
      await api.post(`/credit/tasks/${key}`, { status });
      reload();
    } catch (e: any) {
      pushToast({ kind: "blocked", title: "Can't update that yet", body: e.message });
    }
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Credit building</h1>
          <p className="text-muted text-sm">A rule-based, step-by-step plan for {data.country_label}. Tick tasks off as you complete them; dependencies unlock the next steps.</p>
        </div>
        {!data.saved && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => askRemi(`I just arrived in the ${session?.user.host_country} and have no credit history`)}>Ask Remi</Button>
            <Button data-testid="credit-create" onClick={async () => { await api.post("/credit/create"); reload(); }}>Start tracking</Button>
          </div>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><CreditPlanCard data={data} onToggle={data.saved ? toggle : undefined} /></div>
        <Card>
          <h3 className="font-display mb-2 font-semibold">How the score works</h3>
          <p className="text-muted text-sm leading-relaxed">Each task carries points. Readiness = (done points + ½ in-progress points) ÷ total points. It's a simulated planning aid, not a real credit score.</p>
          <h3 className="font-display mb-2 mt-5 font-semibold">Next steps</h3>
          <ol className="list-decimal space-y-1 pl-4 text-sm">{data.next_steps.map((s: any) => <li key={s.task_key}>{s.title}<div className="text-muted text-xs">{s.description}</div></li>)}</ol>
        </Card>
      </div>
    </div>
  );
}
