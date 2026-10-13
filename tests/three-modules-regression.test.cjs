/* eslint-disable @typescript-eslint/no-require-imports -- Node source regression harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("knowledge management scopes every database mutation to the authenticated owner", () => {
  const page = source("app/knowledge/page.tsx");
  assert.match(page, /from\("knowledge_sources"\)[\s\S]*?\.eq\("user_id",auth\.user\.id\)/);
  assert.match(page, /\.update\([\s\S]*?\.eq\("id",editingId\)\.eq\("user_id",auth\.user\.id\)/);
  assert.match(page, /\.delete\(\)\.eq\("id",source\.id\)\.eq\("user_id",auth\.user\.id\)/);
  assert.match(page, /window\.confirm\(t\.confirm\)/);
  assert.match(page, /submitting\.current/);
});

test("knowledge management provides listing, search, edit, delete and localized RTL UI", () => {
  const page = source("app/knowledge/page.tsx");
  for (const signal of ["setSources", "setQuery", "beginEdit", "remove(source", "useAuthLocale", "AuthPreferences"]) {
    assert.ok(page.includes(signal), `missing ${signal}`);
  }
  assert.match(page, /dir=\{rtl\?"rtl":"ltr"\}/);
  assert.match(page, /معلوماتي زېرمه/);
  assert.match(page, /پایگاه دانش/);
});

test("knowledge import validates real documents server-side and prevents exact duplicates", () => {
  const api = source("app/api/knowledge/import/route.ts");
  const ui = source("components/knowledge-import.tsx");
  assert.match(api, /accountApi\(request\)/);
  assert.match(api, /validateAndProcessFile\(file\)/);
  assert.match(api, /pdf\|docx\|txt/);
  assert.match(api, /eq\("user_id", auth\.user\.id\)/);
  assert.match(api, /eq\("title", title\)\.eq\("content", content\)/);
  assert.match(ui, /accept="\.pdf,\.docx,\.txt/);
});

test("test chat uses English UI and localized security and failure state keys", () => {
  const page = source("app/chat/page.tsx");
  assert.match(page, /useAuthLocale/);
  assert.match(page, /const t=labels\[locale\]/);
  assert.match(page, /setError\(t\.limit\)/);
  assert.match(page, /setError\(!agentOnline\?t\.agentOffline:t\.quota\)/);
  assert.match(page, /aria-label=\{t\.send\}/);
  assert.doesNotMatch(page, /aria-label="Language"|<option value="ps"|<option value="fa"/);
});

test("agent configuration saves identity, behavior and widget welcome data for the authenticated owner", () => {
  const page = source("app/agent/page.tsx");
  for (const table of ["agent_settings", "business_profiles", "widget_settings"]) assert.ok(page.includes(`from(\"${table}\")`));
  for (const field of ["businessName.trim()", "businessDescription.trim()", "agentName.trim()", "welcomeMessage.trim()", "customInstructions.trim()", "allowed_domains"]) assert.ok(page.includes(field), `missing ${field}`);
  assert.match(page, /\.eq\("user_id", user\.id\)/);
  assert.match(page, /useAuthLocale/);
});

test("chat API preserves origin, quota, ownership and rollback protections", () => {
  const api = source("app/api/chat/route.ts");
  for (const signal of ["isRequestOriginAllowed", "billing_security_reserve_ai_usage", "security_release_ai_usage", "allowed_domains", "public_agent_id", ".eq(\"user_id\", agentId)"]) {
    assert.ok(api.includes(signal), `missing ${signal}`);
  }
});
