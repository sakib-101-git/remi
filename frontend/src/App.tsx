import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useStore } from "./lib/store";
import { Logo, Shell } from "./components/Layout";
import { Button, Skeleton } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";

const Transfers = lazy(() => import("./pages/Transfers"));
const Budget = lazy(() => import("./pages/Budget"));
const Credit = lazy(() => import("./pages/Credit"));
const Audit = lazy(() => import("./pages/Audit"));
const Settings = lazy(() => import("./pages/Settings"));
const Sandbox = lazy(() => import("./pages/Sandbox"));
const Knowledge = lazy(() => import("./pages/Knowledge"));

export default function App() {
  const { session, loading, error, refreshSession, route } = useStore();
  if (loading && !session) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-4"><Logo /><Loader2 className="h-5 w-5 animate-spin text-brand-500" /><p className="text-muted text-xs">Preparing your private sandbox…</p></div>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="space-y-4"><Logo /><p className="text-muted text-sm">{error ?? "Could not start the sandbox."}</p><Button onClick={refreshSession}>Try again</Button></div>
      </div>
    );
  }
  const Page = { dashboard: Dashboard, chat: Chat, transfers: Transfers, budget: Budget, credit: Credit, audit: Audit, settings: Settings, sandbox: Sandbox, knowledge: Knowledge }[route];
  return (
    <Shell>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Page key={`${route}-${session.persona}`} />
      </Suspense>
    </Shell>
  );
}
