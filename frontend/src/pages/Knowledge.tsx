import { useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { useApi, useStore } from "../lib/store";
import { Badge, Card, Skeleton } from "../components/ui";

export default function Knowledge() {
  const { data } = useApi<any[]>("/knowledge");
  const { openKb, askRemi } = useStore();
  const [q, setQ] = useState("");
  const rows = useMemo(() => (data ?? []).filter((a) => a.title.toLowerCase().includes(q.toLowerCase())), [data, q]);
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Knowledge base</h1>
          <p className="text-muted text-sm">{data?.length ?? "…"} curated articles written by our team. Remi retrieves them with hybrid search (local embeddings + BM25) and cites them as sources.</p>
        </div>
        <div className="panel flex h-10 items-center gap-2 rounded-xl px-3"><Search className="text-muted h-4 w-4" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter articles" className="bg-transparent text-sm outline-none" /></div>
      </div>
      {!data ? <Skeleton className="h-64" /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => (
            <Card key={a.slug} className="flex flex-col">
              <button className="text-left" onClick={() => openKb(a.slug)}>
                <BookOpen className="mb-2 h-5 w-5 text-brand-500" />
                <div className="font-medium leading-snug">{a.title}</div>
              </button>
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                <Badge tone="neutral">{a.region}</Badge>
                {a.illustrative && <Badge tone="warning">illustrative</Badge>}
                <button className="ml-auto text-xs font-medium text-brand-600 dark:text-brand-300" onClick={() => askRemi(`Explain: ${a.title}`)}>Ask Remi →</button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
