/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

function compile(file, globals = {}) {
  const filename = path.join(root, file);
  const output = ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, { module: compiled, exports: compiled.exports, URL, Request, fetch, ...globals }, { filename });
  return compiled.exports;
}

test("registration transitions to a dedicated enumeration-safe OTP screen", () => {
  const register = source("app/register/page.tsx");
  assert.match(register, /rememberSignupEmail\(normalizedEmail\)/);
  assert.match(register, /startSignupCooldown\(\)/);
  assert.match(register, /router\.replace\("\/verify-email"\)/);
  assert.match(register, /error\.status === 429/);
  assert.match(register, /authRetrySeconds\(60\)/);
  assert.doesNotMatch(register, /User already registered|email already exists/i);
});
test("signup verification uses six numeric positions, email OTP, cooldown and bounded attempts", () => {
  const page = source("app/verify-email/page.tsx");
  assert.match(page, /const CODE_LENGTH = 6/);
  assert.match(page, /type: "email"/);
  assert.match(page, /inputMode="numeric"/);
  assert.match(page, /onPaste=\{paste\}/);
  assert.match(page, /SIGNUP_MAX_ATTEMPTS/);
  assert.match(page, /recordSignupVerificationFailure/);
  assert.match(page, /signupCooldownSeconds/);
  assert.match(page, /supabase\.auth\.resend\(\{ type: "signup", email \}\)/);
  assert.match(page, /router\.replace\("\/dashboard"\)/);
});

test("confirmation email contains only an OTP and local config requires six digits", () => {
  const template = source("supabase/templates/confirmation.html");
  const config = source("supabase/config.toml");
  assert.match(template, /\{\{ \.Token \}\}/);
  assert.doesNotMatch(template, /ConfirmationURL|TokenHash/);
  assert.match(config, /otp_length = 6/);
  assert.match(config, /max_frequency = "60s"/);
  assert.match(config, /otp_expiry = 900/);
  assert.match(config, /\[auth\.email\.template\.confirmation\]/);
  assert.match(config, /content_path = "\.\/supabase\/templates\/confirmation\.html"/);
});

test("retry-after parser supports seconds and HTTP dates without unbounded waits", () => {
  const { parseRetryAfter } = compile("lib/auth-rate-limit.ts");
  const now = Date.parse("2026-11-04T00:00:00Z");
  assert.equal(parseRetryAfter("75", now), 75);
  assert.equal(parseRetryAfter("Wed, 04 Nov 2026 00:02:00 GMT", now), 120);
  assert.equal(parseRetryAfter("99999", now), 3600);
  assert.equal(parseRetryAfter("invalid", now), null);
});

test("local verification attempts are bounded and reset without weakening server limits", () => {
  const values = new Map();
  const store = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const helpers = compile("lib/signup-verification.ts", { window: {}, localStorage: store, sessionStorage: store });
  for (let i = 0; i < 8; i += 1) helpers.recordSignupVerificationFailure();
  assert.equal(helpers.signupVerificationAttempts(), helpers.SIGNUP_MAX_ATTEMPTS);
  helpers.resetSignupVerificationAttempts();
  assert.equal(helpers.signupVerificationAttempts(), 0);
});

// Hosted email delivery remains a separate staging acceptance test.
