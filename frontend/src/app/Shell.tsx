import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Bell, BookOpen, CreditCard, FlaskConical, Home, LogOut, MessageCircle, MoreHorizontal, PieChart, RotateCcw, ShieldCheck, Wallet } from "lucide-react";
import { api } from "../lib/api";
import { cx, dateTime, initials } from "../lib/format";
import { type Route, useStore } from "../lib/store";
import { Button, Dialog, IconButton, Sheet, Wordmark } from "../ui";

type NavItem = { route: Route; label: string; icon: typeof Home };
const MAIN: NavItem[] = [
  { route: "home", label: "Home", icon: Home },
  { route: "send", label: "Send", icon: ArrowUpRight },
  { route: "wallets", label: "Wallets", icon: Wallet },
  { route: "insights", label: "Insights", icon: PieChart },
  { route: "credit", label: "Credit", icon: CreditCard },
];
const SECONDARY: NavItem[] = [
  { route: "security", label: "Security", icon: ShieldCheck },
  { route: "help", label: "Help", icon: BookOpen },
];
export const ROUTE_TITLE: Record<string, string> = { home: "Home", send: "Send", wallets: "Wallets", insights: "Insights", credit: "Credit", security: "Security", help: "Help", styleguide: "Styleguide" };

function Sidebar() {
  const { route, navigate, setChatOpen } = useStore();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-bg px-4 pb-20 pt-7 lg:flex">
      <button onClick={() => navigate("landing")} className="mb-8 self-start rounded-input px-3" aria-label="Remi home page"><Wordmark height={30} /></button>
      <Button block icon={<MessageCircle className="h-5 w-5" />} onClick={() => setChatOpen(true)} data-testid="nav-chat" className="mb-6">Ask Remi</Button>
      <nav className="flex flex-col gap-1" aria-label="Main">
        {MAIN.map((n) => <NavLink key={n.route} item={n} active={route === n.route} onClick={() => navigate(n.route)} />)}
      </nav>
      <nav className="mt-auto flex flex-col gap-1" aria-label="Secondary">
        {SECONDARY.map((n) => <NavLink key={n.route} item={n} active={route === n.route} onClick={() => navigate(n.route)} small />)}
      </nav>
    </aside>
  );
}

function NavLink({ item, active, onClick, small }: { item: NavItem; active: boolean; onClick: () => void; small?: boolean }) {
  const Icon = item.icon;
  return (
    <button
      data-testid={`nav-${item.route}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cx(
        "flex items-center gap-3 rounded-full px-4 transition-colors",
        small ? "h-10 text-small" : "h-12 text-body",
        active ? "bg-primary-soft font-semibold text-primary" : "text-ink-muted hover:bg-surface-muted hover:text-ink",
      )}
    >
      <Icon className={small ? "h-4 w-4" : "h-5 w-5"} />
      {item.label}
    </button>
  );
}

function Topbar() {
  const { route, titleVisible, navigate } = useStore();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header className={cx("sticky top-0 z-20 flex h-16 items-center gap-3 bg-bg px-4 transition-[border-color] md:px-8", scrolled ? "border-b border-line" : "border-b border-transparent")}>
      <button onClick={() => navigate("landing")} className="lg:hidden" aria-label="Remi home page"><Wordmark height={24} /></button>
      {!titleVisible && <div className="hidden animate-fade-in text-body-strong lg:block">{ROUTE_TITLE[route]}</div>}
      <div className="ml-auto flex items-center gap-1">
        <Notifications />
        <ProfileMenu />
      </div>
    </header>
  );
}

function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}

function Notifications() {
  const { unread, clearUnread, version } = useStore();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  useEffect(() => {
    if (open) api.get<any[]>("/notifications").then(setItems).catch(() => setItems([]));
  }, [open, version]);
  return (
    <div className="relative" ref={ref}>
      <IconButton label="Notifications" onClick={() => { setOpen((v) => !v); clearUnread(); }} data-testid="notifications">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-accent" />}
      </IconButton>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-80 animate-rise rounded-card border border-line bg-surface p-2 shadow-float">
          <div className="px-3 py-2 text-body-strong">Notifications</div>
          {!items ? <p className="px-3 py-4 text-small text-ink-muted">Loading…</p> : items.length === 0 ? (
            <p className="px-3 py-4 text-small text-ink-muted">You're all caught up.</p>
          ) : (
            <div className="scroll-thin max-h-96 overflow-y-auto">
              {items.slice(0, 12).map((n) => (
                <div key={n.id} className="rounded-input px-3 py-2.5 hover:bg-surface-muted">
                  <div className="text-small font-semibold">{n.title}</div>
                  {n.body && <div className="line-clamp-2 text-small text-ink-muted">{n.body}</div>}
                  <div className="text-caption text-ink-muted">{dateTime(n.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileMenu() {
  const { session, setSession, bump, pushToast, refreshSession, navigate } = useStore();
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, open, () => setOpen(false));
  if (!session) return null;
  const switchTo = async (p: string) => {
    setOpen(false);
    if (p === session.persona) return;
    const s = await api.post<any>("/session/persona", { persona: p });
    setSession(s);
    bump();
    pushToast({ kind: "info", title: `You're now ${s.user.name.split(" ")[0]}`, body: s.user.tagline });
  };
  const reset = async () => {
    setOpen(false);
    await api.post("/session/reset");
    await refreshSession();
    bump();
    pushToast({ kind: "info", title: "Your sandbox is fresh again" });
  };
  return (
    <div className="relative" ref={ref}>
      <button data-testid="persona-switcher" onClick={() => setOpen((v) => !v)} aria-label={`${initials(session.user.name)}, profile menu`} className="ml-1 grid h-10 w-10 place-items-center rounded-full bg-primary text-small font-semibold text-on-primary">
        {initials(session.user.name)}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-80 animate-rise rounded-card border border-line bg-surface p-2 shadow-float">
          <div className="px-3 pb-1 pt-2 text-caption text-ink-muted">Try Remi as</div>
          {session.personas.map((p) => (
            <button key={p.persona} onClick={() => switchTo(p.persona)} className={cx("flex w-full items-center gap-3 rounded-input px-3 py-2.5 text-left hover:bg-surface-muted", p.persona === session.persona && "bg-primary-soft")}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-muted text-caption">{initials(p.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-small font-semibold">{p.name}</span>
                <span className="block truncate text-caption text-ink-muted">{p.tagline}</span>
              </span>
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <MenuItem icon={<RotateCcw className="h-4 w-4" />} onClick={reset}>Reset my sandbox</MenuItem>
          <MenuItem icon={<FlaskConical className="h-4 w-4" />} onClick={() => { setOpen(false); setAbout(true); }}>About this demo</MenuItem>
          <MenuItem icon={<LogOut className="h-4 w-4" />} onClick={() => { setOpen(false); navigate("landing"); }}>Back to the home page</MenuItem>
        </div>
      )}
      <Dialog open={about} onClose={() => setAbout(false)} label="About this demo">
        <Wordmark height={28} />
        <h2 className="mt-6 text-h2">About this demo</h2>
        <p className="mt-2 text-body text-ink-muted">Remi is a sandbox built for FinTechathon 2026 (Topic C) by Team Git Push Pray. All people, banks, providers, universities and money are fictional. Nothing here is financial, legal or tax advice.</p>
        <Button className="mt-6" onClick={() => setAbout(false)}>Got it</Button>
      </Dialog>
    </div>
  );
}

function MenuItem({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-input px-3 py-2.5 text-left text-small hover:bg-surface-muted">
      <span className="text-ink-muted">{icon}</span>
      {children}
    </button>
  );
}

function BottomTabs() {
  const { route, navigate, setChatOpen, setDemoOpen } = useStore();
  const [more, setMore] = useState(false);
  const tab = (r: Route, label: string, Icon: typeof Home) => (
    <button key={r} data-testid={`tab-${r}`} onClick={() => navigate(r)} className={cx("flex flex-1 flex-col items-center gap-1 pt-2 text-caption", route === r ? "text-primary" : "text-ink-muted")} aria-current={route === r ? "page" : undefined}>
      <Icon className="h-6 w-6" />
      {label}
    </button>
  );
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-20 items-start border-t border-line bg-surface px-2 pb-3 lg:hidden" aria-label="Main">
        {tab("home", "Home", Home)}
        {tab("send", "Send", ArrowUpRight)}
        <div className="flex flex-1 justify-center">
          <button onClick={() => setChatOpen(true)} data-testid="tab-chat" aria-label="Ask Remi" className="-mt-5 grid h-16 w-16 place-items-center rounded-full border-4 border-bg bg-primary text-on-primary">
            <MessageCircle className="h-6 w-6" />
          </button>
        </div>
        {tab("insights", "Insights", PieChart)}
        <button onClick={() => setMore(true)} className={cx("flex flex-1 flex-col items-center gap-1 pt-2 text-caption", ["wallets", "credit", "security", "help"].includes(route) ? "text-primary" : "text-ink-muted")}>
          <MoreHorizontal className="h-6 w-6" />
          More
        </button>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <div className="flex flex-col gap-1 p-4">
          {[MAIN[2], MAIN[4], ...SECONDARY].map((n) => <NavLink key={n.route} item={n} active={route === n.route} onClick={() => { setMore(false); navigate(n.route); }} />)}
          <button data-testid="more-demo" onClick={() => { setMore(false); setDemoOpen(true); }} className="mt-4 flex h-12 items-center gap-3 rounded-full px-4 text-body text-ink-muted hover:bg-surface-muted">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" /> Demo controls
          </button>
        </div>
      </Sheet>
    </>
  );
}

function DemoPill() {
  const { setDemoOpen } = useStore();
  return (
    <button
      data-testid="nav-sandbox"
      onClick={() => setDemoOpen(true)}
      className="fixed bottom-5 left-5 z-30 hidden h-9 items-center gap-2 rounded-full bg-ink px-4 text-caption text-on-primary transition-transform hover:-translate-y-0.5 lg:inline-flex"
    >
      <span className="h-2 w-2 rounded-full bg-accent" /> Demo
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="bg-surface-muted py-1 text-center text-caption text-ink-muted">Sandbox demo · no real money</div>
        <Topbar />
        <main className="mx-auto w-full max-w-[1120px] px-4 pb-32 pt-6 md:px-8 lg:pb-16">{children}</main>
      </div>
      <BottomTabs />
      <DemoPill />
    </div>
  );
}
