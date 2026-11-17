/* eslint-disable @typescript-eslint/no-require-imports -- Node source regression harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("reports API authenticates and scopes every customer dataset", () => {
  const api = source("app/api/reports/route.ts");
  assert.match(api, /client\.auth\.getUser\(token\)/);
  assert.match(api, /eq\("user_id",user\.id\)/);
  assert.match(api, /conversations!inner\(user_id\)/);
  assert.match(api, /eq\("conversations\.user_id",user\.id\)/);
  for (const table of ["conversations", "messages", "knowledge_sources", "chat_attachments", "usage_limits", "subscriptions"]) {
    assert.ok(api.includes(`\"${table}\"`), `missing ${table}`);
  }
  assert.match(api, /range\(from,from\+999\)/);
  assert.match(api, /366\*86400000/);
  assert.match(api, /Cache-Control":"private, no-store/);
});

test("reports UI exposes localized filters, safe exports and honest unsupported states", () => {
  const page = source("app/reports/page.tsx");
  for (const signal of ["useAuthLocale", "AuthPreferences", "reportCsv", "window.print", "router.replace(\"/login\")", "role=\"alert\""]) assert.ok(page.includes(signal), `missing ${signal}`);
  assert.match(page, /dir=\{rtl\?"rtl":"ltr"\}/);
  assert.match(page, /راپورونه او شننې/);
  assert.match(page, /گزارش‌ها و تحلیل/);
  assert.match(page, /Token usage, failed-response rate/);
});

test("CSV helper neutralizes spreadsheet formula injection", () => {
  const helper = source("lib/reporting.ts");
  assert.match(helper, /\^\[=\+\\-@\]/);
  assert.match(helper, /replaceAll\('\"', '\"\"'\)/);
});

test("dashboard links to localized reports without removing existing modules", () => {
  const page = source("app/dashboard/page.tsx");
  assert.match(page, /href: "\/reports"/);
  for (const route of ["/agent", "/knowledge", "/conversations", "/widget", "/billing", "/settings"]) assert.ok(page.includes(`href: \"${route}\"`));
});
