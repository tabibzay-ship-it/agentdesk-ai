/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("recovery email is code-only and uses the supported Supabase token", () => {
  const template = source("supabase/templates/recovery.html");
  assert.match(template, /\{\{ \.Token \}\}/);
  assert.doesNotMatch(template, /ConfirmationURL|TokenHash/);
  assert.match(template, /Your Password Reset Code/);
  assert.match(template, /did not request a password reset/);
});

test("six digit UI supports paste, numeric input, resend and recovery verification", () => {
  const page = source("app/verify-reset-code/page.tsx");
  assert.match(page, /const CODE_LENGTH = 6/);
  assert.match(page, /onPaste=\{paste\}/);
  assert.match(page, /inputMode="numeric"/);
  assert.match(page, /autoComplete=\{index === 0 \? "one-time-code"/);
  assert.match(page, /type: "recovery"/);
  assert.match(page, /recoveryCooldownSeconds/);
});

test("only a signed recovery AMR authorizes password update", () => {
  const filename = path.join(root, "lib/recovery-flow.ts");
  const output = ts.transpileModule(source("lib/recovery-flow.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, { module: compiled, exports: compiled.exports }, { filename });
  const { hasRecoveryAuthorization } = compiled.exports;
  const email = "synthetic@example.test";
  assert.equal(hasRecoveryAuthorization({ email, amr: [{ method: "recovery", timestamp: 1 }] }, email), true);
  assert.equal(hasRecoveryAuthorization({ email, amr: [{ method: "otp", timestamp: 1 }] }, email), true);
  assert.equal(hasRecoveryAuthorization({ email, amr: [{ method: "password", timestamp: 1 }] }, email), false);
  assert.equal(hasRecoveryAuthorization({ email: "other@example.test", amr: [{ method: "otp", timestamp: 1 }] }, email), false);
  assert.equal(hasRecoveryAuthorization({}, email), false);
});
