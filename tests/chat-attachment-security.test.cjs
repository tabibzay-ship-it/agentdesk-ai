/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS security test harness. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const upload = fs.readFileSync(path.join(root, "app/api/chat/attachments/route.ts"), "utf8");
const download = fs.readFileSync(path.join(root, "app/api/chat/attachments/[id]/route.ts"), "utf8");
const chat = fs.readFileSync(path.join(root, "app/api/chat/route.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261010000000_chat_attachments.sql"), "utf8");

test("attachment endpoints authenticate and scope every object to the caller", () => {
  assert.match(upload, /authenticateChatRequest/); assert.match(upload, /eq\("user_id", auth\.user\.id\)/);
  assert.match(download, /eq\("user_id", auth\.user\.id\)/); assert.match(download, /Content-Security-Policy/);
  assert.match(chat, /authenticated\.user\.id !== agentId/); assert.match(chat, /eq\("visitor_id", visitorId\)/);
});

test("storage stays private and browser roles have no direct table access", () => {
  assert.match(migration, /'chat-attachments', 'chat-attachments', false/);
  assert.match(migration, /force row level security/i); assert.match(migration, /revoke all.+anon, authenticated/i);
  assert.doesNotMatch(migration, /create policy/i); assert.doesNotMatch(migration, /drop policy/i);
});

test("chat sends only processed attachments as untrusted context", () => {
  assert.match(chat, /processing_status", "ready"/); assert.match(chat, /untrusted reference data/);
  assert.match(chat, /input_image/); assert.match(chat, /extracted_text/);
});
