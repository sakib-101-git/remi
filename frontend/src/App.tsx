import { lazy, Suspense } from "react";
import { ChatPanel } from "./app/ChatPanel";
import { ArticleSheet, DemoDrawer, Onboarding, PhoneNotice, ToastHost } from "./app/Overlays";
import { Shell } from "./app/Shell";
import { ChatProvider } from "./lib/chat";
import { useStore } from "./lib/store";
import Home from "./pages/Home";
import Landing from "./pages/Landing";
import { AppIcon, Button, Dots, Skeleton } from "./ui";

const Send = lazy(() => import("./pages/Send"));
const Wallets = lazy(() => import("./pages/Wallets"));
const Insights = lazy(() => import("./pages/Insights"));
const Credit = lazy(() => import("./pages/Credit"));
const Security = lazy(() => import("./pages/Security"));
const Help = lazy(() => import("./pages/Help"));
const Styleguide = lazy(() => import("./pages/Styleguide"));

const PAGES = { home: Home, send: Send, wallets: Wallets, insights: Insights, credit: Credit, security: Security, help: Help, styleguide: Styleguide };

export default function App() {
  const { session, loading, error, refreshSession, route } = useStore();
  if (loading && !session) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-5"><AppIcon size={56} /><Dots className="text-primary" /><p className="text-small text-ink-muted">Preparing your private sandbox</p></div>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-4"><AppIcon size={56} /><p className="text-body text-ink-muted">{error ?? "We couldn't start the sandbox."}</p><Button onClick={refreshSession}>Try again</Button></div>
      </div>
    );
  }
  return (
    <ChatProvider>
      {route === "landing" ? <Landing /> : (
        <Shell>
          <Suspense fallback={<Skeleton className="h-96" />}>
            <Page />
          </Suspense>
          <Onboarding />
        </Shell>
      )}
      <ChatPanel />
      <DemoDrawer />
      <ArticleSheet />
      <PhoneNotice />
      <ToastHost />
    </ChatProvider>
  );
}

function Page() {
  const { route, param, session } = useStore();
  const P = PAGES[route as keyof typeof PAGES] ?? Home;
  return <P key={`${route}-${param ?? ""}-${session?.persona}`} />;
}
