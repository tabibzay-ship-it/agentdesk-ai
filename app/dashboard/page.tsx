
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Locale = "en";

type Conversation = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  created_at: string;
};

type DashboardData = {
  conversations: Conversation[];
  questions: { content: string; created_at: string }[];
  conversationCount: number;
  responseCount: number;
  knowledgeCount: number;
  activityCounts: number[];
  agentOnline: boolean;
  agentName: string;
  welcomeMessage: string;
  widgetInstalled: boolean;
  widgetConfigured: boolean;
  businessCompleted: boolean;
  securityCompleted: boolean;
  billing: {
    plan: string | null;
    status: string | null;
    used: number;
    limit: number;
  };
};

const emptyData: DashboardData = {
  conversations: [],
  questions: [],
  conversationCount: 0,
  responseCount: 0,
  knowledgeCount: 0,
  activityCounts: [0, 0, 0, 0, 0, 0, 0],
  agentOnline: false,
  agentName: "AI Support Assistant",
  welcomeMessage: "Hi! How can I help you today?",
  widgetInstalled: false,
  widgetConfigured: false,
  businessCompleted: false,
  securityCompleted: false,
  billing: { plan: null, status: null, used: 0, limit: 0 },
};

const copy = {
  en: {
    dashboard: "Dashboard",
    overview: "Overview",
    greeting: "Welcome back",
    subtitle: "Here's what's happening with your AI support today.",
    conversations: "Conversations",
    responses: "AI responses",
    leads: "Leads",
    appointments: "Appointments",
    knowledge: "Knowledge sources",
    activity: "Conversation activity",
    last7: "Last 7 days",
    topQuestions: "Top questions",
    agentStatus: "AI agent status",
    online: "Online",
    offline: "Offline",
    openAgent: "Manage agent",
    recent: "Recent conversations",
    viewAll: "View all",
    noConversations: "No conversations yet",
    noQuestions: "Questions will appear here after customers start chatting.",
    knowledgeBase: "Knowledge base",
    sourcesReady: "sources ready",
    manage: "Manage",
    widget: "Website widget",
    installed: "Installed",
    notInstalled: "Not installed",
    customize: "Customize",
    subscription: "Subscription",
    usage: "responses used",
    billing: "Manage billing",
    comingSoon: "Coming soon",
    noData: "No records yet",
    setup: "Setup progress",
    signOut: "Sign out",
    testChat: "Test chat",
    install: "Installation",
    loading: "Loading dashboard...",
    refresh: "Refresh",
    reports: "Reports & analytics",
    settings: "Settings",
    refreshing: "Refreshing...",
    error: "Some dashboard data could not be loaded.",
    thisWeek: "this week",
  },
} as const;

type IconName =
  | "grid" | "bot" | "book" | "chat" | "globe"
  | "card" | "gear" | "trend" | "users"
  | "calendar" | "menu" | "arrow" | "logout" | "refresh";

function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: IconName;
  className?: string;
}) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    bot: <><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M9 11h.01M15 11h.01M8 16h8M12 7V3M9 3h6" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5z" /><path d="M4 6.5v13" /></>,
    chat: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /><path d="M8 9h8M8 13h5" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.3 3 14.7 0 18M12 3c-3 3.3-3 14.7 0 18" /></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h3" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M4 4l3 3M17 17l3 3M20 4l-3 3M7 17l-3 3" /></>,
    trend: <><path d="M3 17l6-6 4 4 8-9" /><path d="M15 6h6v6" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0 2 5" /><path d="M20 4v7h-7" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}

const cardClass =
  "rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-5 shadow-sm sm:p-6";

function Card({ children }: { children: ReactNode }) {
  return <section className={cardClass}>{children}</section>;
}

function Badge({ icon }: { icon: IconName }) {
  return (
    <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-500/10 text-blue-500">
      <Icon name={icon} />
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-[var(--premium-border)] p-5 text-center text-sm text-[var(--premium-text-muted)]">
      {text}
    </div>
  );
}

function Action({
  onClick,
  label,
  rtl,
}: {
  onClick: () => void;
  label: string;
  rtl: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-5 flex w-full items-center justify-between border-t border-[var(--premium-border)] pt-4 text-sm font-bold text-blue-500"
    >
      <span>{label}</span>
      <Icon name="arrow" className={`h-4 w-4 ${rtl ? "rotate-180" : ""}`} />
    </button>
  );
}

function ComingSoon({
  id,
  icon,
  title,
  text,
  badge,
}: {
  id: string;
  icon: IconName;
  title: string;
  text: string;
  badge: string;
}) {
  return (
    <section id={id} className={cardClass}>
      <div className="flex items-center gap-3">
        <Badge icon={icon} />
        <div className="flex-1">
          <h3 className="font-bold">{title}</h3>
          <p className="mt-1 text-xs text-[var(--premium-text-muted)]">{text}</p>
        </div>
        <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-500">
          {badge}
        </span>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const mounted = useRef(true);
  const loadInFlight = useRef(false);

  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [warning, setWarning] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const locale: Locale = "en";

  const [profile, setProfile] = useState({
    name: "",
    email: "",
  });

  const t = copy[locale];
  const rtl = locale !== "en";

  const loadDashboard = useCallback(async (initial = false) => {
      if (loadInFlight.current) return;
      loadInFlight.current = true;
      const refreshStartedAt = initial ? 0 : Date.now();
      if (!initial) setRefreshing(true);
      setWarning(false);
      try {
        const { data: auth, error } = await supabase.auth.getUser();

        if (error || !auth.user) {
          router.replace("/login");
          return;
        }

        const user = auth.user;

        if (mounted.current) {
          setProfile({
            name:
              user.user_metadata?.full_name ??
              user.email?.split("@")[0] ??
              "User",
            email: user.email ?? "",
          });
        }

        const now = new Date();
        const activityWindows = Array.from({ length: 7 }, (_, index) => {
          const offset = 6 - index;
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
          const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset + 1);
          return { start: start.toISOString(), end: end.toISOString() };
        });

        const [
          business,
          knowledge,
          conversationTotal,
          conversations,
          responses,
          questions,
          widget,
          agent,
          session,
          activity,
        ] = await Promise.all([
          supabase.from("business_profiles")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id),

          supabase.from("knowledge_sources")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id),

          supabase.from("conversations")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id),

          supabase.from("conversations")
            .select("id,customer_name,customer_email,created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(20),

          supabase.from("messages")
            .select("id,conversations!inner(user_id)", {
              count: "exact",
              head: true,
            })
            .eq("role", "assistant")
            .eq("conversations.user_id", user.id),

          supabase.from("messages")
            .select("content,created_at,conversations!inner(user_id)")
            .eq("role", "user")
            .eq("conversations.user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(5),

          supabase.from("widget_settings")
            .select("agent_name,welcome_message,is_installed")
            .eq("user_id", user.id)
            .maybeSingle(),

          supabase.from("agent_settings")
            .select("is_active,allowed_domains")
            .eq("user_id", user.id)
            .maybeSingle(),

          supabase.auth.getSession(),

          Promise.all(activityWindows.map(({ start, end }) =>
            supabase.from("conversations")
              .select("id", { count: "exact", head: true })
              .eq("user_id", user.id)
              .gte("created_at", start)
              .lt("created_at", end)
          )),
        ]);

        if (!mounted.current) return;

        setWarning(
          [
            business.error,
            knowledge.error,
            conversationTotal.error,
            conversations.error,
            responses.error,
            questions.error,
            widget.error,
            agent.error,
            session.error,
            ...activity.map((result) => result.error),
          ].some(Boolean)
        );

        let billing = emptyData.billing;
        const token = session.data.session?.access_token;

        if (token) {
          try {
            const response = await fetch("/api/billing", {
              headers: {
                Authorization: `Bearer ${token}`,
              },
              cache: "no-store",
            });

            if (response.ok) {
              const value = await response.json();

              billing = {
                plan: value.subscription?.plan_id ?? null,
                status: value.subscription?.status ?? null,
                used: value.usage?.messages_used ?? 0,
                limit: value.usage?.monthly_limit ?? 0,
              };
            } else {
              setWarning(true);
            }
          } catch {
            if (mounted.current) setWarning(true);
          }
        }

        if (!mounted.current) return;

        const widgetRow = widget.data;
        const agentRow = agent.data;

        setData({
          conversations: (conversations.data ?? []) as Conversation[],
          questions: (questions.data ?? []).map((q) => ({
            content: q.content,
            created_at: q.created_at,
          })),
          conversationCount: conversationTotal.count ?? 0,
          responseCount: responses.count ?? 0,
          knowledgeCount: knowledge.count ?? 0,
          activityCounts: activity.map((result) => result.count ?? 0),
          businessCompleted: (business.count ?? 0) > 0,
          widgetConfigured: Boolean(widgetRow),
          widgetInstalled: widgetRow?.is_installed === true,
          agentOnline: agentRow?.is_active === true,
          securityCompleted:
            Array.isArray(agentRow?.allowed_domains) &&
            agentRow.allowed_domains.some(
              (domain) =>
                typeof domain === "string" &&
                Boolean(domain.trim())
            ),
          agentName: widgetRow?.agent_name || emptyData.agentName,
          welcomeMessage:
            widgetRow?.welcome_message || emptyData.welcomeMessage,
          billing,
        });
      } catch {
        if (mounted.current) setWarning(true);
      } finally {
        if (!initial) {
          const remainingFeedbackTime = 350 - (Date.now() - refreshStartedAt);
          if (remainingFeedbackTime > 0) {
            await new Promise((resolve) =>
              window.setTimeout(resolve, remainingFeedbackTime)
            );
          }
        }
        loadInFlight.current = false;
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
  }, [router]);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => void loadDashboard(true), 0);

    return () => {
      window.clearTimeout(timer);
      mounted.current = false;
    };
  }, [loadDashboard]);

  function go(href: string) {
    setMenuOpen(false);
    router.push(href);
  }

  async function signOut() {
    if (signingOut) return;

    setSignOutError("");
    setSigningOut(true);

    try {
      const { error } = await supabase.auth.signOut({
        scope: "global",
      });

      if (error) {
        setSignOutError("Could not sign out. Please try again.");
        return;
      }

      router.replace("/login");
    } catch {
      setSignOutError("Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  const activityDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - i));
    return date;
  });

  const activityValues = data.activityCounts;

  const activityMax = Math.max(...activityValues, 1);

  const nav: {
    icon: IconName;
    label: string;
    href: string;
  }[] = [
    { icon: "grid", label: t.dashboard, href: "/dashboard" },
    { icon: "bot", label: t.openAgent, href: "/agent" },
    { icon: "book", label: t.knowledgeBase, href: "/knowledge" },
    { icon: "chat", label: t.conversations, href: "/conversations" },
    { icon: "users", label: t.leads, href: "/leads" },
    { icon: "calendar", label: t.appointments, href: "/appointments" },
    { icon: "globe", label: t.widget, href: "/widget" },
    { icon: "card", label: t.subscription, href: "/billing" },
    { icon: "trend", label: t.reports, href: "/reports" },
    { icon: "gear", label: t.settings, href: "/settings" },
  ];

  const done = [
    data.businessCompleted,
    data.knowledgeCount > 0,
    data.widgetConfigured,
    data.securityCompleted,
    data.widgetInstalled,
  ].filter(Boolean).length;

  const usage =
    data.billing.limit > 0
      ? Math.min(
          100,
          Math.round((data.billing.used / data.billing.limit) * 100)
        )
      : 0;

  const stats: {
    icon: IconName;
    label: string;
    value: string | number;
    href?: string;
    tone: string;
  }[] = [
    {
      icon: "chat",
      label: t.conversations,
      value: data.conversationCount,
      href: "/conversations",
      tone: "bg-blue-500/10 text-blue-500",
    },
    {
      icon: "bot",
      label: t.responses,
      value: data.responseCount,
      href: "/conversations",
      tone: "bg-violet-500/10 text-violet-500",
    },
    {
      icon: "users",
      label: t.leads,
      value: "—",
      href: "/leads",
      tone: "bg-emerald-500/10 text-emerald-500",
    },
    {
      icon: "calendar",
      label: t.appointments,
      value: "—",
      href: "/appointments",
      tone: "bg-amber-500/10 text-amber-500",
    },
    {
      icon: "book",
      label: t.knowledge,
      value: data.knowledgeCount,
      href: "/knowledge",
      tone: "bg-rose-500/10 text-rose-500",
    },
  ];

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] text-[var(--foreground)]">
        <div role="status" className="flex items-center gap-3">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          {t.loading}
        </div>
      </main>
    );
  }

  return (
    <main
      dir={rtl ? "rtl" : "ltr"}
      className="min-h-screen bg-[var(--background)] text-[var(--foreground)]"
    >
      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/45 lg:hidden"
        />
      )}

      <aside
        className={[
          "fixed inset-y-0 z-40 flex w-[min(86vw,260px)] flex-col bg-[#101b35] px-4 py-6 text-white shadow-2xl transition-transform lg:w-[260px] lg:translate-x-0",
          rtl ? "right-0" : "left-0",
          menuOpen
            ? "translate-x-0"
            : rtl
              ? "translate-x-full"
              : "-translate-x-full",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => go("/dashboard")}
          className="mb-8 flex items-center gap-3 px-3 text-start"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-sm font-black">
            AD
          </span>
          <span>
            <span className="block text-lg font-bold">AgentDesk AI</span>
            <span className="block text-xs text-blue-300">
              Smart support
            </span>
          </span>
        </button>

        <nav className="space-y-1.5">
          {nav.map((item) => (
            <button
              key={item.href}
              type="button"
              onClick={() => go(item.href)}
              className={[
                "flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-start text-sm font-medium transition",
                item.href === "/dashboard"
                  ? "bg-blue-600 text-white"
                  : "text-slate-300 hover:bg-white/10 hover:text-white",
              ].join(" ")}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex justify-between text-xs">
            <span className="text-slate-300">{t.setup}</span>
            <span className="font-bold text-blue-300">{done}/5</span>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-blue-500"
              style={{ width: `${done * 20}%` }}
            />
          </div>

          <button
            type="button"
            onClick={() => go("/install")}
            className="mt-3 flex items-center gap-2 text-xs font-semibold"
          >
            {t.install}
            <Icon name="arrow" className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <section
        className={`min-h-screen ${
          rtl ? "lg:mr-[260px]" : "lg:ml-[260px]"
        }`}
      >
        <header className="sticky top-0 z-20 flex min-h-[76px] items-center justify-between gap-2 border-b border-[var(--premium-border)] bg-[var(--premium-surface)] px-3 sm:gap-3 sm:px-7 xl:px-9">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMenuOpen(true)}
              className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--premium-border)] lg:hidden"
            >
              <Icon name="menu" />
            </button>

            <div className="hidden min-[375px]:block">
              <h1 className="text-lg font-bold">{t.dashboard}</h1>
              <p className="text-xs text-[var(--premium-text-muted)]">
                {t.overview}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <button
              type="button"
              onClick={() => void loadDashboard(false)}
              disabled={refreshing}
              aria-label={refreshing ? t.refreshing : t.refresh}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface)] px-3 text-sm font-semibold hover:bg-[var(--premium-surface-muted)] disabled:cursor-wait disabled:opacity-60 sm:px-4"
            >
              <Icon name="refresh" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden md:inline">{refreshing ? t.refreshing : t.refresh}</span>
            </button>

            <div className="hidden text-end sm:block">
              <p className="max-w-40 truncate text-sm font-semibold">
                {profile.name}
              </p>
              <p className="max-w-40 truncate text-xs text-[var(--premium-text-muted)]">
                {profile.email}
              </p>
            </div>

            <span className="grid h-10 w-10 place-items-center rounded-full bg-blue-500/10 text-sm font-bold text-blue-500">
              {profile.name.charAt(0).toUpperCase()}
            </span>

            <button
              type="button"
              aria-label={t.signOut}
              disabled={signingOut}
              onClick={() => void signOut()}
              className="grid h-10 w-10 place-items-center rounded-xl text-[var(--premium-text-muted)] hover:bg-blue-500/10 disabled:opacity-50"
            >
              <Icon name="logout" />
            </button>
          </div>
        </header>

        <div id="main-content" className="mx-auto max-w-[1540px] space-y-5 p-3 min-[375px]:p-4 sm:p-7 xl:p-9">
          {signOutError && (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">
              {signOutError}
            </div>
          )}

          {warning && (
            <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-600">
              {t.error}
            </div>
          )}

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold sm:text-3xl">
                {t.greeting}, {profile.name.split(" ")[0]} 👋
              </h2>
              <p className="mt-2 text-sm text-[var(--premium-text-muted)]">
                {t.subtitle}
              </p>
            </div>

            <button
              type="button"
              onClick={() => go("/chat")}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Icon name="chat" className="h-4 w-4" />
              {t.testChat}
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {stats.map((stat) => (
              <button
                key={stat.label}
                type="button"
                disabled={!stat.href}
                onClick={() => {
                  if (stat.href) go(stat.href);
                }}
                className={`${cardClass} text-start transition enabled:hover:-translate-y-0.5 disabled:cursor-default`}
              >
                <div className="flex items-start justify-between">
                  <span className={`grid h-11 w-11 place-items-center rounded-xl ${stat.tone}`}>
                    <Icon name={stat.icon} />
                  </span>
                  <span className="text-xs text-[var(--premium-text-muted)]">
                    {typeof stat.value === "number"
                      ? t.thisWeek
                      : t.comingSoon}
                  </span>
                </div>

                <p className="mt-5 text-3xl font-bold">{stat.value}</p>
                <p className="mt-1 text-sm text-[var(--premium-text-muted)]">
                  {stat.label}
                </p>
              </button>
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.85fr)]">
            <Card>
              <div className="flex justify-between">
                <div>
                  <h3 className="font-bold">{t.activity}</h3>
                  <p className="mt-1 text-xs text-[var(--premium-text-muted)]">
                    {t.last7}
                  </p>
                </div>
                <Badge icon="trend" />
              </div>

              <div className="mt-8 flex h-48 items-end gap-1.5 sm:gap-4">
                {activityValues.map((value, index) => (
                  <div
                    key={activityDays[index].toISOString()}
                    className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                  >
                    <span className="text-xs font-semibold">
                      {value || ""}
                    </span>

                    <div
                      className="w-full max-w-12 rounded-t-lg bg-gradient-to-t from-blue-600 to-blue-400"
                      style={{
                        height: `${Math.max(
                          8,
                          (value / activityMax) * 145
                        )}px`,
                        opacity: value ? 1 : 0.18,
                      }}
                    />

                    <span className="text-center text-xs text-[var(--premium-text-muted)]">
                      {activityDays[index].toLocaleDateString(
                        locale === "en" ? "en" : "fa-AF",
                        { weekday: "short" }
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <div className="flex justify-between">
                <h3 className="font-bold">{t.topQuestions}</h3>
                <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-500">
                  LIVE
                </span>
              </div>

              <div className="mt-5 space-y-3">
                {data.questions.length ? (
                  data.questions.map((question, index) => (
                    <div
                      key={`${question.created_at}-${index}`}
                      className="flex gap-3 rounded-xl bg-[var(--premium-surface-muted)] p-3"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--premium-surface)] text-xs font-bold text-blue-500">
                        {index + 1}
                      </span>
                      <p className="line-clamp-2 text-sm">
                        {question.content}
                      </p>
                    </div>
                  ))
                ) : (
                  <Empty text={t.noQuestions} />
                )}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card>
              <div className="flex justify-between gap-3">
                <h3 className="font-bold">{t.agentStatus}</h3>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    data.agentOnline
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-rose-500/10 text-rose-500"
                  }`}
                >
                  {data.agentOnline ? t.online : t.offline}
                </span>
              </div>

              <div className="mt-6 flex items-center gap-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#101b35] font-black text-white">
                  AI
                </span>
                <div className="min-w-0">
                  <p className="font-bold">{data.agentName}</p>
                  <p className="mt-1 line-clamp-1 text-xs text-[var(--premium-text-muted)]">
                    {data.welcomeMessage}
                  </p>
                </div>
              </div>

              <Action
                onClick={() => go("/agent")}
                label={t.openAgent}
                rtl={rtl}
              />
            </Card>

            <Card>
              <div className="flex justify-between">
                <h3 className="font-bold">{t.knowledgeBase}</h3>
                <Badge icon="book" />
              </div>
              <p className="mt-6 text-3xl font-bold">
                {data.knowledgeCount}
              </p>
              <p className="mt-1 text-sm text-[var(--premium-text-muted)]">
                {t.sourcesReady}
              </p>
              <Action
                onClick={() => go("/knowledge")}
                label={t.manage}
                rtl={rtl}
              />
            </Card>

            <Card>
              <div className="flex justify-between gap-3">
                <h3 className="font-bold">{t.widget}</h3>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    data.widgetInstalled
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-amber-500/10 text-amber-500"
                  }`}
                >
                  {data.widgetInstalled
                    ? t.installed
                    : t.notInstalled}
                </span>
              </div>

              <div className="mt-6 rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface-muted)] p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-blue-600 text-xs font-black text-white">
                    AI
                  </span>
                  <div className="h-2.5 w-24 rounded-full bg-blue-500/20" />
                </div>
                <div className="mt-4 h-9 rounded-lg bg-[var(--premium-surface)]" />
              </div>

              <Action
                onClick={() => go("/widget")}
                label={t.customize}
                rtl={rtl}
              />
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
            <Card>
              <div className="flex justify-between">
                <h3 className="font-bold">{t.recent}</h3>
                <button
                  type="button"
                  onClick={() => go("/conversations")}
                  className="text-xs font-bold text-blue-500"
                >
                  {t.viewAll}
                </button>
              </div>

              <div className="mt-4 divide-y divide-[var(--premium-border)]">
                {data.conversations.slice(0, 5).map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => go("/conversations")}
                    className="flex w-full items-center gap-3 py-3.5 text-start"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-500/10 text-xs font-bold text-blue-500">
                      {(conversation.customer_name || "V")
                        .charAt(0)
                        .toUpperCase()}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {conversation.customer_name || "Website visitor"}
                      </span>
                      <span className="block truncate text-xs text-[var(--premium-text-muted)]">
                        {conversation.customer_email || t.conversations}
                      </span>
                    </span>

                    <time className="text-xs text-[var(--premium-text-muted)]">
                      {new Date(conversation.created_at).toLocaleDateString(
                        locale === "en" ? "en" : "fa-AF",
                        { month: "short", day: "numeric" }
                      )}
                    </time>
                  </button>
                ))}

                {!data.conversations.length && (
                  <Empty text={t.noConversations} />
                )}
              </div>
            </Card>

            <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#17264b] to-[#10182e] p-6 text-white">
              <div className="flex justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-blue-300">
                    {t.subscription}
                  </p>
                  <h3 className="mt-2 text-2xl font-bold capitalize">
                    {data.billing.plan
                      ? `${data.billing.plan} plan`
                      : "—"}
                  </h3>
                </div>
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10">
                  <Icon name="card" />
                </span>
              </div>

              <div className="mt-8">
                <div className="mb-2 flex justify-between gap-2 text-xs">
                  <span className="text-slate-300">{t.usage}</span>
                  <span className="font-bold">
                    {data.billing.limit
                      ? `${data.billing.used.toLocaleString()} / ${data.billing.limit.toLocaleString()}`
                      : "—"}
                  </span>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-blue-400"
                    style={{ width: `${usage}%` }}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => go("/billing")}
                  className="mt-6 flex w-full items-center justify-between rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold hover:bg-white/15"
                >
                  <span>{t.billing}</span>
                  <Icon name="arrow" className="h-4 w-4" />
                </button>
              </div>
            </section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <ComingSoon
              id="appointments"
              icon="calendar"
              title={t.appointments}
              text={t.noData}
              badge={t.comingSoon}
            />
            <ComingSoon
              id="leads"
              icon="users"
              title={t.leads}
              text={t.noData}
              badge={t.comingSoon}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
