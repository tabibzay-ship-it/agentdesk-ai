import { NextResponse } from "next/server";
import { accountApi } from "@/lib/account-api";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
});

export async function GET(request: Request) {
  const auth = await accountApi(request);
  if (!auth) return reply({ error: "Unauthorized" }, 401);
  const { data, error } = await auth.admin.from("business_availability")
    .select("weekday,start_time,end_time,timezone,enabled").eq("user_id", auth.user.id).order("weekday");
  return error ? reply({ error: "Could not load availability." }, 503) : reply({ rows: data ?? [] });
}

export async function PUT(request: Request) {
  const auth = await accountApi(request);
  if (!auth) return reply({ error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => null) as { rows?: unknown; timezone?: unknown } | null;
  const timezone = typeof body?.timezone === "string" ? body.timezone.trim().slice(0, 80) : "";
  try { Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { return reply({ error: "Invalid timezone." }, 400); }
  if (!Array.isArray(body?.rows) || body.rows.length !== 7) return reply({ error: "Seven weekdays are required." }, 400);
  const seen = new Set<number>();
  let rows: { user_id: string; weekday: number; start_time: string; end_time: string; timezone: string; enabled: boolean }[];
  try {
    rows = body.rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const weekday = Number(row.weekday), start = String(row.start ?? ""), end = String(row.end ?? "");
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seen.has(weekday) || !TIME.test(start) || !TIME.test(end) || start >= end) throw new Error();
      seen.add(weekday);
      return { user_id: auth.user.id, weekday, start_time: start, end_time: end, timezone, enabled: Boolean(row.enabled) };
    });
  } catch { return reply({ error: "Invalid availability schedule." }, 400); }
  const { data, error } = await auth.admin.from("business_availability").upsert(rows, { onConflict: "user_id,weekday" })
    .select("weekday,start_time,end_time,timezone,enabled");
  return error ? reply({ error: "Could not save availability." }, 503) : reply({ rows: data ?? [] });
}
