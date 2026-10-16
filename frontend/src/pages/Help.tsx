import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Search } from "lucide-react";
import { ArticleBody } from "../app/ArticleSheet";
import { api } from "../lib/api";
import { useApi, useStore } from "../lib/store";
import { Badge, Button, Card, EmptyState, ErrorState, Input, ListRow, PageHeader, RowIcon, Skeleton, SkeletonRows, useTitleRef } from "../ui";

const REGION: Record<string, string> = { UK: "UK", CA: "Canada", US: "US", BD: "Bangladesh", NG: "Nigeria", IN: "India" };
const TOPICS: { title: string; match: RegExp }[] = [
  { title: "Staying safe", match: /scam|fraud|kyc|identity|monitor|reported|safety/i },
  { title: "Credit", match: /credit/i },
  { title: "Tuition", match: /tuition|proof-of-funds|purpose/i },
  { title: "Sending money", match: /transfer|fx|fee|landed|cross-border|convert|limit|split/i },
  { title: "Budgeting", match: /budget|runway|rent|wallet|money last/i },
];
const topicOf = (a: any) => TOPICS.find((t) => t.match.test(`${a.slug} ${a.title}`))?.title ?? "Budgeting";

export default function Help() {
  const { param } = useStore();
  return param ? <Article slug={param} /> : <ArticleList />;
}

function ArticleList() {
  const { data, error, reload } = useApi<any[]>("/knowledge");
  const { navigate } = useStore();
  const [q, setQ] = useState("");
  const rows = useMemo(() => (data ?? []).filter((a) => a.title.toLowerCase().includes(q.toLowerCase())), [data, q]);
  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader title="Help" description="Short guides on fees, tuition payments, credit and staying safe from scams." />
      <Input leading={<Search className="h-5 w-5" />} placeholder="Search help articles" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search help articles" className="mb-6" />
      {error && <ErrorState message={error} onRetry={reload} />}
      {!data ? <Card className="py-6"><SkeletonRows rows={6} /></Card> : rows.length === 0 ? <EmptyState title="No articles match your search." /> : (
        <div className="space-y-10">
          {TOPICS.map((t) => {
            const items = rows.filter((a) => topicOf(a) === t.title);
            if (!items.length) return null;
            return (
              <section key={t.title}>
                <h2 className="mb-3 text-h2">{t.title}</h2>
                <Card className="py-2">
                  <div className="divide-y divide-line">
                    {items.map((a) => (
                      <ListRow
                        key={a.slug}
                        data-testid="help-article"
                        onClick={() => navigate("help", a.slug)}
                        leading={<RowIcon><BookOpen className="h-5 w-5" /></RowIcon>}
                        title={a.title}
                        subtitle={REGION[a.region]}
                        trailing={a.illustrative ? <Badge tone="warning">Illustrative</Badge> : undefined}
                        chevron
                      />
                    ))}
                  </div>
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Article({ slug }: { slug: string }) {
  const { navigate, askRemi } = useStore();
  const [art, setArt] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useTitleRef();
  useEffect(() => {
    setArt(null);
    api.get<any>(`/knowledge/${slug}`).then(setArt).catch((e) => setErr(e.message));
  }, [slug]);
  return (
    <div className="mx-auto max-w-[680px]">
      <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} className="-ml-3 mb-4" onClick={() => navigate("help")}>All articles</Button>
      {err ? <ErrorState message={err} /> : !art ? <Skeleton className="h-96" /> : (
        <>
          <h1 ref={titleRef} className="text-h1">{art.title}</h1>
          <div className="-mx-6"><ArticleBody article={art} /></div>
          <Card tone="muted" className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body">Still not sure what this means for you?</p>
            <Button size="sm" onClick={() => askRemi(`Explain this for my situation: ${art.title}`)}>Ask Remi</Button>
          </Card>
        </>
      )}
    </div>
  );
}
