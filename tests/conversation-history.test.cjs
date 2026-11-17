/* eslint-disable @typescript-eslint/no-require-imports -- source security regression harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("conversation management API authenticates and scopes every operation to the owner", () => {
  const api = source("app/api/conversations/route.ts");
  assert.match(api, /authenticateChatRequest\(request\)/);
  assert.ok((api.match(/\.eq\("user_id", auth\.user\.id\)/g) || []).length >= 6);
  assert.match(api, /export async function PATCH/);
  assert.match(api, /export async function DELETE/);
  assert.match(api, /CHAT_ATTACHMENT_BUCKET/);
  assert.match(api, /order\("created_at", \{ ascending: true \}\)\.order\("id"/);
});

test("conversation history supports search, pagination, rename, confirmed delete and attachments", () => {
  const page = source("app/conversations/page.tsx");
  for (const signal of ["conversation-search", "Load older conversations", "New conversation", "Rename", "Delete conversation?", "Message attachments"]) {
    assert.ok(page.includes(signal), `missing ${signal}`);
  }
  assert.match(page, /ConfirmDialog/);
  assert.match(page, /overflow-x-hidden/);
  assert.match(page, /min-w-0/);
});

test("conversation migration keeps writes server-only and efficiently orders account history", () => {
  const migration = source("supabase/migrations/20261015000000_conversation_history.sql");
  assert.match(migration, /^begin;/m);
  assert.match(migration, /conversations_user_updated_idx/);
  assert.match(migration, /revoke insert, update, delete on public\.conversations from public, anon, authenticated/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /commit;/);
});

test("chat retries use a durable server-only idempotency ledger", () => {
  const migration = source("supabase/migrations/20261016000000_chat_request_idempotency.sql");
  const api = source("app/api/chat/route.ts");
  const chat = source("app/chat/page.tsx");
  const widget = source("public/widget.js");
  assert.match(migration, /^begin;/m);
  assert.match(migration, /create table if not exists public\.chat_request_keys/);
  assert.match(migration, /id uuid primary key/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table public\.chat_request_keys from public, anon, authenticated/);
  assert.match(migration, /commit;/);
  assert.match(api, /claimError\.code !== "23505"/);
  assert.match(api, /status === "completed"[\s\S]*replayed: true/);
  assert.match(api, /already being processed/);
  assert.match(api, /request_hash/);
  assert.match(chat, /requestId=crypto\.randomUUID\(\)/);
  assert.match(widget, /requestId:[\s\S]*crypto\.randomUUID\(\)/);
});
