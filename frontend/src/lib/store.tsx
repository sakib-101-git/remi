import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";

export type Persona = { persona: string; name: string; tagline: string; reporting_currency: string; host_country: string };
export type Session = {
  workspace_token: string;
  persona: string;
  user: { name: string; tagline: string; home_country: string; host_country: string; university: string; reporting_currency: string; kyc_status: string; student_id: string };
  personas: Persona[];
  consent_given: boolean;
  agent_paused: boolean;
  sim_now: string;
  clock_offset_seconds: number;
  demo_mode: boolean;
  llm: { providers: { name: string; model: string; available: boolean }[]; cache_mode: string; primary: string };
  disclaimer: string;
};
export type Toast = { id: number; kind: string; title: string; body?: string; data?: any };
export type PhoneMessage = { id: number; action_id: string; code: string; message: string; expires_at: string; at: number };
export type Route = "landing" | "home" | "send" | "wallets" | "insights" | "credit" | "security" | "help" | "styleguide";

export const APP_ROUTES: Route[] = ["home", "send", "wallets", "insights", "credit", "security", "help", "styleguide"];
// Old links (and bookmarks from the first UI) keep working.
const LEGACY: Record<string, { route: Route; open?: "chat" | "demo" }> = {
  dashboard: { route: "home" }, chat: { route: "home", open: "chat" }, transfers: { route: "send" }, budget: { route: "insights" },
  audit: { route: "security" }, settings: { route: "security" }, knowledge: { route: "help" }, sandbox: { route: "home", open: "demo" },
};

type Store = {
  session: Session | null;
  loading: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
  setSession: (s: Session) => void;
  route: Route;
  param: string | null;
  navigate: (r: Route, param?: string | null) => void;
  version: number;
  bump: () => void;
  toast: Toast | null;
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: () => void;
  phone: PhoneMessage | null;
  dismissPhone: () => void;
  kbSlug: string | null;
  openKb: (slug: string | null) => void;
  chatOpen: boolean;
  setChatOpen: (v: boolean) => void;
  chatDraft: { message: string; attachment?: string; autoSend?: boolean } | null;
  askRemi: (message: string, opts?: { attachment?: string; autoSend?: boolean }) => void;
  consumeDraft: () => void;
  demoOpen: boolean;
  setDemoOpen: (v: boolean) => void;
  liveEvents: { event: string; data: any; at: number }[];
  unread: number;
  clearUnread: () => void;
  tokenCards: Record<string, any>;
  connected: boolean;
  titleVisible: boolean;
  setTitleVisible: (v: boolean) => void;
};

const Ctx = createContext<Store | null>(null);
const IMPORTANT_TOASTS = new Set(["fraud", "rate_alert", "blocked"]);

function parseHash(): { route: Route; param: string | null; open?: "chat" | "demo" } {
  const [head, ...rest] = window.location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
  if (!head) return { route: "landing", param: null };
  if (LEGACY[head]) return { ...LEGACY[head], param: null };
  const route = (APP_ROUTES as string[]).includes(head) ? (head as Route) : "home";
  return { route, param: rest.length ? decodeURIComponent(rest.join("/")) : null };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const initial = useRef(parseHash());
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(initial.current.route);
  const [param, setParam] = useState<string | null>(initial.current.param);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [phone, setPhone] = useState<PhoneMessage | null>(null);
  const [kbSlug, setKbSlug] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(initial.current.open === "chat");
  const [demoOpen, setDemoOpen] = useState(initial.current.open === "demo");
  const [chatDraft, setChatDraft] = useState<Store["chatDraft"]>(null);
  const [liveEvents, setLiveEvents] = useState<Store["liveEvents"]>([]);
  const [unread, setUnread] = useState(0);
  const [tokenCards, setTokenCards] = useState<Record<string, any>>({});
  const [connected, setConnected] = useState(false);
  const [titleVisible, setTitleVisible] = useState(true);
  const toastId = useRef(1);
  const toastTimer = useRef<number | null>(null);
  const bumpTimer = useRef<number | null>(null);

  const bump = useCallback(() => {
    if (bumpTimer.current) window.clearTimeout(bumpTimer.current);
    bumpTimer.current = window.setTimeout(() => setVersion((v) => v + 1), 120);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      setSession(await api.get<Session>("/session"));
      setError(null);
    } catch (e: any) {
      setError(e.message || "Could not reach the Remi server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const onHash = () => {
      const h = parseHash();
      setRoute(h.route);
      setParam(h.param);
      if (h.open === "chat") setChatOpen(true);
      if (h.open === "demo") setDemoOpen(true);
      setTitleVisible(true);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // One toast at a time: a newer event replaces the current one.
  const toastRef = useRef<Toast | null>(null);
  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    // A routine confirmation never hides a warning or a rate alert that is still on screen.
    if (t.kind === "info" && toastRef.current && IMPORTANT_TOASTS.has(toastRef.current.kind)) return;
    const id = toastId.current++;
    toastRef.current = { ...t, id };
    setToast({ ...t, id });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      toastRef.current = null;
      setToast((cur) => (cur?.id === id ? null : cur));
    }, IMPORTANT_TOASTS.has(t.kind) ? 9000 : 5000);
  }, []);

  // Live events: settlement updates, alerts, step-up codes and notifications.
  useEffect(() => {
    if (!session) return;
    let es: EventSource | null = null;
    let retry: number | null = null;
    const connect = () => {
      es = new EventSource("/api/events", { withCredentials: true });
      es.addEventListener("hello", () => setConnected(true));
      const record = (event: string) => (e: MessageEvent) => {
        let data: any = {};
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        setLiveEvents((prev) => [...prev.slice(-80), { event, data, at: Date.now() }]);
        if (event === "sandbox_phone") {
          setPhone({ id: Date.now(), at: Date.now(), ...data });
        } else if (event === "notification") {
          pushToast({ kind: data.kind, title: data.title, body: data.body, data: data.data });
          setUnread((n) => n + 1);
          const act = data.data?.action;
          if (act?.id && act.confirm_token) setTokenCards((prev) => ({ ...prev, [act.id]: act }));
        } else if (event === "settings") {
          setSession((s) => (s ? { ...s, agent_paused: data.agent_paused } : s));
        } else if (event === "clock") {
          setSession((s) => (s ? { ...s, sim_now: data.sim_now, clock_offset_seconds: data.offset_seconds } : s));
        }
        bump();
      };
      ["transaction", "action", "notification", "sandbox_phone", "fx", "alert", "clock", "settings", "reset"].forEach((ev) => es!.addEventListener(ev, record(ev) as EventListener));
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      es?.close();
      if (retry) window.clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect only when the workspace changes, not on every session update
  }, [session?.workspace_token, bump, pushToast]);

  const navigate = useCallback((r: Route, p: string | null = null) => {
    window.location.hash = r === "landing" ? "/" : `/${r}${p ? `/${encodeURIComponent(p)}` : ""}`;
    setRoute(r);
    setParam(p);
    setTitleVisible(true);
    window.scrollTo({ top: 0 });
  }, []);

  const askRemi = useCallback((message: string, opts?: { attachment?: string; autoSend?: boolean }) => {
    setChatDraft({ message, attachment: opts?.attachment, autoSend: opts?.autoSend ?? true });
    setDemoOpen(false);
    setChatOpen(true);
  }, []);

  const value = useMemo<Store>(
    () => ({
      session, loading, error, refreshSession, setSession, route, param, navigate, version, bump,
      toast, pushToast, dismissToast: () => { toastRef.current = null; setToast(null); },
      phone, dismissPhone: () => setPhone(null),
      kbSlug, openKb: setKbSlug,
      chatOpen, setChatOpen, chatDraft, askRemi, consumeDraft: () => setChatDraft(null),
      demoOpen, setDemoOpen,
      liveEvents, unread, clearUnread: () => setUnread(0), tokenCards, connected,
      titleVisible, setTitleVisible,
    }),
    [session, loading, error, refreshSession, route, param, navigate, version, bump, toast, pushToast, phone, kbSlug, chatOpen, chatDraft, askRemi, demoOpen, liveEvents, unread, tokenCards, connected, titleVisible],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

/** Fetch helper that refetches whenever live events bump the version. */
export function useApi<T>(path: string | null, deps: unknown[] = []): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const { version } = useStore();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    api
      .get<T>(path)
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version, nonce, ...deps]);
  return { data, error, loading, reload: () => setNonce((n) => n + 1) };
}

/** Simulated "now" in ms (sandbox clock offset applied), ticking every second. */
export function useSimNow(): number {
  const { session } = useStore();
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return tick + (session?.clock_offset_seconds ?? 0) * 1000;
}
