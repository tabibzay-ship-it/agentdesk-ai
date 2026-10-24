/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS security test harness. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const upload = fs.readFileSync(path.join(root, "app/api/chat/attachments/route.ts"), "utf8");
const download = fs.readFileSync(path.join(root, "app/api/chat/attachments/[id]/route.ts"), "utf8");
const chat = fs.readFileSync(path.join(root, "app/api/chat/route.ts"), "utf8");
const exportsRoute = fs.readFileSync(path.join(root, "app/api/chat/exports/route.ts"), "utf8");
const imageEdit = fs.readFileSync(path.join(root, "app/api/chat/attachments/[id]/edit/route.ts"), "utf8");
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

test("chat routes visual requests without pretending unsupported generation succeeded", () => {
  assert.match(chat, /classifyImageRequest/);
  assert.match(chat, /createTemplateImage/);
  assert.match(chat, /true generative image-editing provider, which is currently disabled/);
  assert.match(chat, /eq\("user_id", agentId\)/);
  assert.match(chat, /MAX_ACCOUNT_STORAGE_BYTES/);
});

test("exports and image edits require auth, same-origin requests, ownership and quotas", () => {
  for (const source of [exportsRoute, imageEdit]) {
    assert.match(source, /authenticateChatRequest/);
    assert.match(source, /sameApplicationOrigin/);
    assert.match(source, /eq\("user_id", auth\.user\.id\)/);
    assert.match(source, /MAX_ACCOUNT_STORAGE_BYTES/);
    assert.match(source, /check_chat_rate_limit/);
  }
  assert.match(exportsRoute, /eq\("role", "assistant"\)/);
  assert.match(imageEdit, /eq\("kind", "image"\)/);
});
