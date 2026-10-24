"use client";

type Item = { id: string; customer_name: string; customer_email: string | null; customer_phone: string | null; service: string; starts_at: string; ends_at: string; timezone: string; status: string; notes: string; reminder_status: string };
type View = "day" | "week" | "month";

function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function localInput(date: Date) { const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }

export function AppointmentCalendar({ rows, cursor, view, locale, onSlot, onEdit }: { rows: Item[]; cursor: Date; view: View; locale: "en" | "ps" | "fa"; onSlot: (start: string, end: string) => void; onEdit: (row: Item) => void }) {
  const lang = locale === "en" ? "en-US" : "fa-AF";
  const start = new Date(cursor); start.setHours(0, 0, 0, 0);
  const days: Date[] = [];
  if (view === "day") days.push(start);
  if (view === "week") { start.setDate(start.getDate() - start.getDay()); for (let i = 0; i < 7; i += 1) { const day = new Date(start); day.setDate(start.getDate() + i); days.push(day); } }
  if (view === "month") { start.setDate(1); const grid = new Date(start); grid.setDate(1 - grid.getDay()); for (let i = 0; i < 42; i += 1) { const day = new Date(grid); day.setDate(grid.getDate() + i); days.push(day); } }
  const slots = view === "month" ? [] : Array.from({ length: 10 }, (_, index) => index + 8);
  function choose(day: Date, hour = 9) { const begin = new Date(day); begin.setHours(hour, 0, 0, 0); const end = new Date(begin); end.setMinutes(end.getMinutes() + 30); onSlot(localInput(begin), localInput(end)); }
  if (view === "month") return <div className="grid grid-cols-7 overflow-hidden rounded-2xl border border-[var(--premium-border)]" role="grid" aria-label="Monthly appointment calendar">{days.map((day, index) => { const events = rows.filter(row => sameDay(new Date(row.starts_at), day)); return <button key={day.toISOString()} type="button" onClick={() => choose(day)} className={`min-h-24 border-b border-e border-[var(--premium-border)] p-2 text-start focus:z-10 focus:outline-2 focus:outline-blue-500 ${day.getMonth() !== cursor.getMonth() ? "opacity-45" : ""}`}><span className="text-xs font-black">{index < 7 && day.toLocaleDateString(lang, { weekday: "short" })} {day.getDate()}</span>{events.slice(0, 3).map(event => <span key={event.id} onClick={e => { e.stopPropagation(); onEdit(event); }} className="mt-1 block truncate rounded bg-blue-600 px-1.5 py-1 text-[10px] font-bold text-white">{new Date(event.starts_at).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" })} {event.customer_name}</span>)}</button>; })}</div>;
  return <div className="overflow-x-auto rounded-2xl border border-[var(--premium-border)]"><div className={`grid min-w-[680px] ${view === "day" ? "grid-cols-1" : "grid-cols-7"}`}>{days.map(day => <div key={day.toISOString()} className="border-e border-[var(--premium-border)] last:border-e-0"><h3 className="border-b border-[var(--premium-border)] p-3 text-center text-sm font-black">{day.toLocaleDateString(lang, { weekday: "short", month: "short", day: "numeric" })}</h3>{slots.map(hour => { const event = rows.find(row => { const date = new Date(row.starts_at); return sameDay(date, day) && date.getHours() === hour; }); return <button key={hour} type="button" onClick={() => event ? onEdit(event) : choose(day, hour)} className={`block min-h-14 w-full border-b border-[var(--premium-border)] px-2 text-start text-xs ${event ? "bg-blue-600/10 font-bold text-blue-600" : "hover:bg-blue-500/5"}`}>{String(hour).padStart(2, "0")}:00 {event ? `· ${event.customer_name}` : ""}</button>; })}</div>)}</div></div>;
}
