/* eslint-disable @typescript-eslint/no-require-imports -- Node regression test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const source = fs.readFileSync(path.resolve(__dirname, "../app/dashboard/page.tsx"), "utf8");

test("dashboard totals are exact and scoped to the authenticated account", () => {
  assert.match(source, /from\("conversations"\)[\s\S]*?select\("id", \{ count: "exact", head: true \}\)[\s\S]*?\.eq\("user_id", user\.id\)/);
  assert.match(source, /from\("knowledge_sources"\)[\s\S]*?count: "exact"[\s\S]*?\.eq\("user_id", user\.id\)/);
  assert.match(source, /from\("messages"\)[\s\S]*?count: "exact"[\s\S]*?\.eq\("role", "assistant"\)[\s\S]*?\.eq\("conversations\.user_id", user\.id\)/);
});

test("seven-day activity uses exact bounded database counts", () => {
  assert.match(source, /Array\.from\(\{ length: 7 \}/);
  assert.match(source, /new Date\(now\.getFullYear\(\), now\.getMonth\(\), now\.getDate\(\) - offset\)/);
  assert.match(source, /select\("id", \{ count: "exact", head: true \}\)[\s\S]*?\.eq\("user_id", user\.id\)[\s\S]*?\.gte\("created_at", start\)[\s\S]*?\.lt\("created_at", end\)/);
  assert.match(source, /\.\.\.activity\.map\(\(result\) => result\.error\)/);
});

test("dashboard refresh uses English UI and does not reload the document", () => {
  assert.match(source, /refresh: "Refresh"/);
  assert.doesNotMatch(source, /\bps:\s*\{/);
  assert.doesNotMatch(source, /\bfa:\s*\{/);
  assert.match(source, /onClick=\{\(\) => void loadDashboard\(false\)\}/);
  assert.match(source, /if \(loadInFlight\.current\) return;/);
  assert.match(source, /loadInFlight\.current = true;/);
  assert.match(source, /loadInFlight\.current = false;/);
  assert.match(source, /disabled=\{refreshing\}/);
  assert.match(source, /refreshing \? "animate-spin" : ""/);
  assert.match(source, /remainingFeedbackTime = 350/);
  assert.doesNotMatch(source, /location\.reload|window\.location\.reload/);
});

test("320px header keeps controls while avoiding horizontal overflow", () => {
  assert.match(source, /className="hidden min-\[375px\]:block"/);
  assert.match(source, /aria-label=\{refreshing \? t\.refreshing : t\.refresh\}/);
  assert.match(source, /aria-label=\{t\.signOut\}/);
});

test("authentication and query failures fail closed with visible feedback", () => {
  assert.match(source, /if \(error \|\| !auth\.user\) \{[\s\S]*?router\.replace\("\/login"\)/);
  assert.match(source, /setWarning\([\s\S]*?business\.error[\s\S]*?conversationTotal\.error[\s\S]*?responses\.error[\s\S]*?\.\.\.activity\.map/);
  assert.match(source, /catch \{[\s\S]*?setWarning\(true\)/);
  assert.match(source, /role="alert"/);
  assert.match(source, /role="status"/);
});
