import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { useStore } from "../lib/store";
import { Badge, Note, Sheet } from "../ui";

/** Help article in a side panel (opened from source chips in chat). */
export function ArticleSheet() {
  const { kbSlug, openKb } = useStore();
  const [art, setArt] = useState<any>(null);
  useEffect(() => {
    if (!kbSlug) return;
    setArt(null);
    api.get<any>(`/knowledge/${kbSlug}`).then(setArt).catch(() => setArt({ title: "Article not found", body: "This article could not be loaded." }));
  }, [kbSlug]);
  return (
    <Sheet open={!!kbSlug} onClose={() => openKb(null)} title={art?.title ?? "Help"} width="lg">
      {art ? <ArticleBody article={art} /> : <div className="p-6 text-small text-ink-muted">Loading…</div>}
    </Sheet>
  );
}

export function ArticleBody({ article }: { article: any }) {
  return (
    <div data-testid="kb-article" className="px-6 py-6">
      <div className="mb-5 flex flex-wrap gap-2">
        {article.illustrative && <Badge tone="warning">Illustrative · verify with official sources</Badge>}
        {article.last_reviewed && <Badge>Reviewed {date(article.last_reviewed)}</Badge>}
      </div>
      <div className="prose-remi text-body"><ReactMarkdown>{article.body}</ReactMarkdown></div>
      <Note className="mt-8">General information written by Team Git Push Pray for this sandbox. Not financial, legal or tax advice.</Note>
    </div>
  );
}

