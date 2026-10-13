import { authenticateAdminRequest, adminJson, writeAdminAudit } from "@/lib/admin-server";

export const runtime = "nodejs";

const SECTIONS = new Set(["overview", "users", "agents", "conversations", "subscriptions", "revenue", "health", "security", "settings"]);

function integer(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function safeSearch(value: string | null) {
  const clean = (value || "").trim().slice(0, 100);
  return /^[\p{L}\p{N}@._+\- ]*$/u.test(clean) ? clean.toLocaleLowerCase() : "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const authentication = await authenticateAdminRequest(request);
  if ("response" in authentication) return authentication.response;
  const { admin, user, requestId } = authentication;
  const url = new URL(request.url);
  const section = url.searchParams.get("section") || "overview";
  if (!SECTIONS.has(section)) return adminJson({ error: "Unknown administrator section.", code: "INVALID_SECTION" }, 400);
  const page = integer(url.searchParams.get("page"), 1, 1, 10_000);
  const pageSize = integer(url.searchParams.get("pageSize"), 20, 10, 100);
  const search = safeSearch(url.searchParams.get("search"));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    let payload: Record<string, unknown>;
    if (section === "overview") {
      const [users, agents, activeAgents, conversations, messages, usage, subscriptions] = await Promise.all([
        admin.auth.admin.listUsers({ page: 1, perPage: 1 }),
        admin.from("agent_settings").select("user_id", { count: "exact", head: true }),
        admin.from("agent_settings").select("user_id", { count: "exact", head: true }).eq("is_active", true),
        admin.from("conversations").select("id", { count: "exact", head: true }),
        admin.from("messages").select("id", { count: "exact", head: true }).eq("role", "assistant"),
        admin.from("usage_limits").select("messages_used,monthly_limit"),
        admin.from("subscriptions").select("plan_id,status"),
      ]);
      const failed = [users.error, agents.error, activeAgents.error, conversations.error, messages.error, usage.error, subscriptions.error].find(Boolean);
      if (failed) throw new Error("overview");
      const byPlan = { free: 0, starter: 0, pro: 0 };
      for (const item of subscriptions.data ?? []) if (item.plan_id in byPlan) byPlan[item.plan_id as keyof typeof byPlan]++;
      payload = {
        stats: {
          users: ("total" in users.data ? users.data.total : undefined) ?? users.data.users.length,
          agents: agents.count ?? 0,
          activeAgents: activeAgents.count ?? 0,
          conversations: conversations.count ?? 0,
          aiResponses: messages.count ?? 0,
          messagesUsed: (usage.data ?? []).reduce((sum, item) => sum + Number(item.messages_used || 0), 0),
          monthlyCapacity: (usage.data ?? []).reduce((sum, item) => sum + Number(item.monthly_limit || 0), 0),
          subscriptions: byPlan,
        },
      };
    } else if (section === "users") {
      const authUsers = await admin.auth.admin.listUsers({ page: search ? 1 : page, perPage: search ? 1000 : pageSize });
      if (authUsers.error) throw new Error("users");
      const filtered = search ? authUsers.data.users.filter((item) => `${item.email || ""} ${item.id}`.toLocaleLowerCase().includes(search)) : authUsers.data.users;
      const rows = search ? filtered.slice(from, to + 1) : filtered;
      const ids = rows.map((item) => item.id);
      const [subscriptions, usage, agents] = ids.length ? await Promise.all([
        admin.from("subscriptions").select("user_id,plan_id,status").in("user_id", ids),
        admin.from("usage_limits").select("user_id,messages_used,monthly_limit").in("user_id", ids),
        admin.from("agent_settings").select("user_id,is_active").in("user_id", ids),
      ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
      if (subscriptions.error || usage.error || agents.error) throw new Error("users");
      payload = {
        rows: rows.map((item) => ({
          id: item.id,
          email: item.email || "",
          createdAt: item.created_at,
          confirmedAt: item.email_confirmed_at || null,
          lastSignInAt: item.last_sign_in_at || null,
          bannedUntil: item.banned_until || null,
          subscription: subscriptions.data?.find((row) => row.user_id === item.id) || null,
          usage: usage.data?.find((row) => row.user_id === item.id) || null,
          agent: agents.data?.find((row) => row.user_id === item.id) || null,
        })),
        total: search ? filtered.length : (("total" in authUsers.data ? authUsers.data.total : undefined) ?? rows.length), page, pageSize,
        searchCapped: Boolean(search && "total" in authUsers.data && authUsers.data.total && authUsers.data.total > 1000),
      };
    } else if (section === "agents") {
      let query = admin.from("agent_settings").select("user_id,public_agent_id,is_active,allowed_domains", { count: "exact" }).order("user_id").range(from, to);
      if (search) query = UUID_RE.test(search) ? query.or(`user_id.eq.${search},public_agent_id.ilike.%${search}%`) : query.ilike("public_agent_id", `%${search}%`);
      const result = await query;
      if (result.error) throw new Error("agents");
      payload = { rows: result.data ?? [], total: result.count ?? 0, page, pageSize };
    } else if (section === "conversations") {
      const [total, messages, recent] = await Promise.all([
        admin.from("conversations").select("id", { count: "exact", head: true }),
        admin.from("messages").select("id", { count: "exact", head: true }),
        admin.from("conversations").select("id,user_id,created_at").order("created_at", { ascending: false }).range(from, to),
      ]);
      if (total.error || messages.error || recent.error) throw new Error("conversations");
      payload = { total: total.count ?? 0, messages: messages.count ?? 0, rows: recent.data ?? [], page, pageSize };
    } else if (section === "subscriptions") {
      let query = admin.from("subscriptions").select("id,user_id,plan_id,status,current_period_start,current_period_end,cancel_at_period_end,created_at,updated_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
      if (search) query = UUID_RE.test(search) ? query.or(`user_id.eq.${search},plan_id.ilike.%${search}%,status.ilike.%${search}%`) : query.or(`plan_id.ilike.%${search}%,status.ilike.%${search}%`);
      const result = await query;
      if (result.error) throw new Error("subscriptions");
      payload = { rows: result.data ?? [], total: result.count ?? 0, page, pageSize };
    } else if (section === "revenue") {
      const result = await admin.from("payment_transactions").select("amount_cents,currency,status,occurred_at,created_at").eq("status", "succeeded").order("occurred_at", { ascending: false }).range(from, to);
      if (result.error) throw new Error("revenue");
      const totals: Record<string, number> = {};
      for (const item of result.data ?? []) totals[item.currency] = (totals[item.currency] || 0) + item.amount_cents;
      payload = { paymentsEnabled: false, verifiedTransactions: result.data ?? [], visiblePageTotalsCents: totals, page, pageSize };
    } else if (section === "health") {
      const started = Date.now();
      const [plans, audit] = await Promise.all([
        admin.from("subscription_plans").select("code", { count: "exact", head: true }),
        admin.from("admin_audit_events").select("id", { count: "exact", head: true }),
      ]);
      payload = { database: plans.error || audit.error ? "degraded" : "healthy", latencyMs: Date.now() - started, auth: "reachable", payments: "disabled", checkedAt: new Date().toISOString() };
    } else if (section === "security") {
      const result = await admin.from("admin_audit_events").select("id,admin_user_id,action,target_type,target_id,outcome,request_id,created_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
      if (result.error) throw new Error("security");
      payload = { rows: result.data ?? [], total: result.count ?? 0, page, pageSize, mfaEnforced: true, browserAdminTablesBlocked: true };
    } else {
      payload = { settings: { paymentsEnabled: false, adminMfaRequired: true, publicAdminSignup: false, attachmentBucketPrivate: true, customerRlsPreserved: true }, writable: false };
    }

    await writeAdminAudit(admin, user.id, `admin.${section}.read`, requestId, "allowed", { page, pageSize, search: Boolean(search) });
    return adminJson({ section, ...payload });
  } catch {
    try { await writeAdminAudit(admin, user.id, `admin.${section}.read`, requestId, "failed"); } catch { /* fail closed below */ }
    return adminJson({ error: "Administrator data is temporarily unavailable.", code: "ADMIN_READ_FAILED" }, 503);
  }
}
