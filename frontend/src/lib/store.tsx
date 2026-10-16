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
export type Route = "dashboard" | "chat" | "transfers" | "budget" | "credit" | "audit" | "settings" | "sandbox" | "knowledge";

type Store = {
  session: Session | null;
  loading: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
  setSession: (s: Session) => void;
  route: Route;
  navigate: (r: Route) => void;
  version: number;
  bump: () => void;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  phone: PhoneMessage[];
  phoneOpen: boolean;
  setPhoneOpen: (v: boolean) => void;
  kbSlug: string | null;
  openKb: (slug: string | null) => void;
  chatDraft: { message: string; attachment?: string; autoSend?: boolean } | null;
  askRemi: (message: string, opts?: { attachment?: string; autoSend?: boolean }) => void;
  consumeDraft: () => void;
  liveEvents: { event: string; data: any; at: number }[];
  connected: boolean;
  theme: "light" | "dark";
  toggleTheme: () => void;
};

const Ctx = createContext<Store | null>(null);

function routeFromHash(): Route {
  const h = window.location.hash.replace(/^#\/?/, "").split("?")[0] as Route;
  return (["dashboard", "chat", "transfers", "budget", "credit", "audit", "settings", "sandbox", "knowledge"] as Route[]).includes(h) ? h : "dashboard";
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(routeFromHash());
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [phone, setPhone] = useState<PhoneMessage[]>([]);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [kbSlug, setKbSlug] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState<Store["chatDraft"]>(null);
  const [liveEvents, setLiveEvents] = useState<Store["liveEvents"]>([]);
  const [connected, setConnected] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(document.documentElement.classList.contains("dark") ? "dark" : "light");
  const toastId = useRef(1);
  const bumpTimer = useRef<number | null>(null);

  const bump = useCallback(() => {
    if (bumpTimer.current) window.clearTimeout(bumpTimer.current);
    bumpTimer.current = window.setTimeout(() => setVersion((v) => v + 1), 120);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const s = await api.get<Session>("/session");
      setSession(s);
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
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = toastId.current++;
    setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.kind === "fraud" || t.kind === "rate_alert" ? 12000 : 7000);
  }, []);

  // Live events: settlement updates, alerts, OTP on the sandbox phone, notifications.
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
          setPhone((prev) => [{ id: Date.now(), at: Date.now(), ...data }, ...prev].slice(0, 12));
          setPhoneOpen(true);
        } else if (event === "notification") {
          pushToast({ kind: data.kind, title: data.title, body: data.body, data: data.data });
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
  }, [session?.workspace_token, bump, pushToast]);

  const navigate = useCallback((r: Route) => {
    window.location.hash = `/${r}`;
    setRoute(r);
  }, []);

  const value = useMemo<Store>(
    () => ({
      session,
      loading,
      error,
      refreshSession,
      setSession,
      route,
      navigate,
      version,
      bump,
      toasts,
      pushToast,
      dismissToast: (id) => setToasts((prev) => prev.filter((t) => t.id !== id)),
      phone,
      phoneOpen,
      setPhoneOpen,
      kbSlug,
      openKb: setKbSlug,
      chatDraft,
      askRemi: (message, opts) => {
        setChatDraft({ message, attachment: opts?.attachment, autoSend: opts?.autoSend ?? true });
        navigate("chat");
      },
      consumeDraft: () => setChatDraft(null),
      liveEvents,
      connected,
      theme,
      toggleTheme: () => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.classList.toggle("dark", next === "dark");
        try {
          localStorage.setItem("remi-theme", next);
        } catch {
          /* storage unavailable */
        }
        setTheme(next);
      },
    }),
    [session, loading, error, refreshSession, route, navigate, version, bump, toasts, pushToast, phone, phoneOpen, kbSlug, chatDraft, liveEvents, connected, theme],
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
