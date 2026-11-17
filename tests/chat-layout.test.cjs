/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const chatPage = fs.readFileSync(
  path.join(process.cwd(), "app", "chat", "page.tsx"),
  "utf8",
);

test("chat uses a full-viewport shell with no page-level scrolling", () => {
  assert.match(chatPage, /h-\[100dvh\] overflow-hidden/);
  assert.match(chatPage, /h-full min-h-0[^\"]*overflow-hidden/);
  assert.match(chatPage, /min-h-0 flex-1 flex-col overflow-hidden/);
});

test("desktop sidebar keeps a labelled dashboard action visible", () => {
  assert.match(chatPage, /<aside[^>]*lg:flex/);
  assert.match(
    chatPage,
    /<button type="button" onClick=\{\(\)=>router\.push\("\/dashboard"\)\}[^>]*>[\s\S]*?<span>\{t\.back\}<\/span><\/button>/,
  );
});

test("mobile header keeps an accessible dashboard action visible", () => {
  assert.match(chatPage, /<header[^>]*shrink-0/);
  assert.match(chatPage, /aria-label=\{t\.back\}[^>]*>[\s\S]*?<span className="sm:hidden">Back<\/span>/);
});

test("messages scroll independently and composer stays in document flow", () => {
  assert.match(chatPage, /min-h-0 flex-1 overflow-y-auto overscroll-contain/);
  assert.match(chatPage, /shrink-0 border-t border-\[var\(--premium-border\)\]/);
  assert.doesNotMatch(chatPage, /absolute inset-x-0 bottom-0/);
});
