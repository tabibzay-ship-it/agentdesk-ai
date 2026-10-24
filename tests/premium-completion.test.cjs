/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS regression harness. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("public SEO metadata uses the official origin and canonical home URL", () => {
  const layout = read("app/layout.tsx");
  const home = read("app/page.tsx");
  assert.match(layout, /metadataBase:\s*new URL\("https:\/\/getagentdeskai\.com"\)/);
  assert.match(layout, /openGraph:/);
  assert.match(home, /alternates:\s*\{ canonical: "\/" \}/);
  assert.match(home, /<ThemeSwitcher compact/);
  assert.match(home, /<Link[\s\S]*href="\/login"/);
  assert.match(home, /"@type": "SoftwareApplication"/);
  assert.match(home, /application\/ld\+json/);
  assert.match(home, /JSON\.stringify\(structuredData\)\.replace\(\/<\/g/);
});

test("robots and sitemap publish only public account-entry routes", () => {
  const robots = read("app/robots.ts");
  const sitemap = read("app/sitemap.ts");
  for (const route of ["/admin", "/api", "/dashboard", "/chat", "/billing", "/settings"]) assert.match(robots, new RegExp(`"${route}"`));
  assert.match(robots, /sitemap: "https:\/\/getagentdeskai\.com\/sitemap\.xml"/);
  assert.doesNotMatch(sitemap, /dashboard|admin|billing|chat/);
});

test("global failure and not-found experiences are accessible and recoverable", () => {
  const failure = read("app/global-error.tsx");
  const missing = read("app/not-found.tsx");
  assert.match(failure, /onClick=\{reset\}/);
  assert.match(failure, /Your data was not changed/);
  assert.match(missing, /href="\/"/);
});

test("the main application is English-only without removing global themes", () => {
  const preferences = read("components/auth-preferences.tsx");
  assert.match(preferences, /const locale: AuthLocale = "en"/);
  assert.match(preferences, /export function AppPreferences/);
  assert.match(preferences, /<ThemeSwitcher/);
  assert.doesNotMatch(preferences, /<select|agentdesk-language|AUTH_LANGUAGE_KEY|localStorage/);
  assert.match(read("public/widget.js"), /messagesByLocale/);
});

test("business profile is account scoped, validated and themed", () => {
  const page = read("app/business/page.tsx");
  assert.match(page, /supabase\.auth\.getUser\(\)/);
  assert.match(page, /\.upsert\(\{ user_id: user\.id/);
  assert.match(page, /onConflict: "user_id"/);
  assert.match(page, /isHttpWebsite\(values\.website\)/);
  assert.match(page, /dir=\{rtl \? "rtl" : "ltr"\}/);
  assert.match(page, /<AuthPreferences/);
});

test("billing remains provider-disabled with the approved plan source of truth", () => {
  const plans = read("lib/billing-config.ts");
  const provider = read("lib/payments/provider.ts");
  assert.match(plans, /name: "Free"[\s\S]*priceCents: 0/);
  assert.match(plans, /name: "Starter"[\s\S]*priceCents: 900/);
  assert.match(plans, /name: "Pro"[\s\S]*priceCents: 2_900/);
  assert.match(provider, /name: "disabled"/);
  assert.match(provider, /configured: false/);
});

test("billing migration keeps idempotency, RLS and verified-event ordering", () => {
  const migration = read("supabase/migrations/20261009000000_subscription_billing.sql");
  assert.match(migration, /create table if not exists public\.subscription_plans/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /provider_event_at/);
  assert.match(migration, /p_occurred_at < v_subscription\.provider_event_at/);
  assert.match(migration, /revoke all on function public\.billing_process_verified_event/);
});

test("widget, conversations, knowledge and chat retain authenticated ownership controls", () => {
  assert.match(read("app/widget/page.tsx"), /\.eq\("user_id", user\.id\)/);
  const conversationApi = read("app/api/conversations/route.ts");
  assert.match(conversationApi, /authenticateChatRequest/);
  assert.match(conversationApi, /\.eq\("user_id", auth\.user\.id\)/);
  assert.match(read("app/knowledge/page.tsx"), /\.eq\("user_id",\s*auth\.user\.id\)/);
  assert.match(read("app/api/chat/route.ts"), /authorization/i);
});

test("embedded widget is localized, theme-aware and keyboard accessible", () => {
  const widget = read("public/widget.js");
  assert.match(widget, /messagesByLocale/);
  assert.match(widget, /settings\.theme === "system"/);
  assert.match(widget, /setAttribute\("role", "dialog"\)/);
  assert.match(widget, /setAttribute\("aria-expanded", String\(opening\)\)/);
  assert.match(widget, /event\.key === "Escape"/);
  assert.match(widget, /prefers-reduced-motion/);
  assert.doesNotMatch(widget, /innerHTML\s*=\s*settings\./);
});

test("conversation browsing uses bounded tenant-scoped pagination", () => {
  const conversations = read("app/conversations/page.tsx");
  const conversationApi = read("app/api/conversations/route.ts");
  assert.match(conversationApi, /const PAGE_SIZE = 25/);
  assert.match(conversationApi, /\.eq\("user_id", auth\.user\.id\)[\s\S]*\.range\(offset, offset \+ PAGE_SIZE\)/);
  assert.match(conversations, /Load older conversations/);
});

test("widget customization preview reflects size, position, theme and locale", () => {
  const widgetPage = read("app/widget/page.tsx");
  assert.match(widgetPage, /position === "left" \? "justify-start" : "justify-end"/);
  assert.match(widgetPage, /size === "compact"[\s\S]*size === "large"/);
  assert.match(widgetPage, /widgetTheme === "dark"[\s\S]*widgetTheme === "light"/);
  assert.match(widgetPage, /Customer widget language/);
  assert.match(widgetPage, /widgetLocale === "ps"[\s\S]*widgetLocale === "fa"/);
  assert.match(widgetPage, /locale: widgetLocale/);
});
