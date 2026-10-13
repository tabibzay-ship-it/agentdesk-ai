/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function source(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }

function securityHelpers() {
  const filename = path.join(root, "lib/client-security.ts");
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, { module: compiled, exports: compiled.exports, URL, atob }, { filename });
  return compiled.exports;
}

test("auth redirects accept only local non-auth destinations", () => {
  const { safeAuthDestination } = securityHelpers();
  assert.equal(safeAuthDestination("/conversations?filter=open#recent"), "/conversations?filter=open#recent");
  for (const value of [null, "", "https://evil.example", "//evil.example", "/login", "/register/path", "/verify-reset-code", "/reset-password"]) {
    assert.equal(safeAuthDestination(value), "/dashboard");
  }
});

test("password policy is bounded and requires letters and numbers", () => {
  const { isStrongPassword } = securityHelpers();
  assert.equal(isStrongPassword("correcthorse7"), true);
  for (const value of ["short7", "onlyletterslong", "123456789012", `a1${"x".repeat(1023)}`, "validpass123\0"]) {
    assert.equal(isStrongPassword(value), false);
  }
});

test("login and registration prevent duplicate submissions and expose accessible states", () => {
  const login = source("app/login/page.tsx");
  const register = source("app/register/page.tsx");
  for (const page of [login, register]) {
    assert.match(page, /if \(submitting\.current\) return/);
    assert.match(page, /submitting\.current = true/);
    assert.match(page, /role="alert"/);
    assert.match(page, /role="status"/);
  }
  assert.match(register, /password !== confirmPassword/);
  assert.match(register, /emailRedirectTo/);
});

test("recovery OTP flow is enumeration-safe and reset requires signed recovery claims", () => {
  const forgot = source("app/forgot-password/page.tsx");
  const verify = source("app/verify-reset-code/page.tsx");
  const reset = source("app/reset-password/page.tsx");
  assert.match(forgot, /resetPasswordForEmail/);
  assert.match(forgot, /If an account exists/);
  assert.match(forgot, /router\.push\("\/verify-reset-code"\)/);
  assert.match(forgot, /startRecoveryCooldown/);
  assert.match(source("lib/recovery-flow.ts"), /60_000/);
  assert.match(verify, /verifyOtp\(\{ email, token, type: "recovery" \}\)/);
  assert.match(verify, /\^\\d\{6\}\$/);
  assert.match(verify, /Resend Code/);
  assert.match(reset, /recoveryState !== "ready"/);
  assert.match(reset, /getClaims\(\)/);
  assert.match(reset, /hasRecoveryAuthorization/);
  assert.match(reset, /updateUser\(\{ password \}\)/);
  assert.match(reset, /signOut\(\{ scope: "local" \}\)/);
  assert.match(forgot, /if \(recoveryError\)/);
});

test("auth pages use English-only UI and share global theme controls", () => {
  const preferences = source("components/auth-preferences.tsx");
  const translations = source("lib/auth-i18n.ts");
  for (const page of ["login", "register", "forgot-password", "verify-reset-code", "reset-password"]) {
    const contents = source(`app/${page}/page.tsx`);
    assert.match(contents, /useAuthLocale/);
    assert.match(contents, /<AuthPreferences/);
  }
  assert.match(preferences, /<ThemeSwitcher/);
  assert.doesNotMatch(preferences, /<select|پښتو|دری/);
  assert.match(preferences, /const locale: AuthLocale = "en"/);
  assert.match(translations, /Welcome back/);
});

test("login and registration forms expose associated labels and live feedback", () => {
  const login = source("app/login/page.tsx");
  const register = source("app/register/page.tsx");
  for (const id of ["login-email", "login-password"]) {
    assert.match(login, new RegExp(`htmlFor="${id}"`));
    assert.match(login, new RegExp(`id="${id}"`));
  }
  for (const id of ["register-name", "register-email", "register-password", "confirm-password"]) {
    assert.match(register, new RegExp(`(?:htmlFor|id)="${id}"`));
  }
  assert.match(login, /aria-live="assertive"/);
  assert.match(register, /aria-live="polite"/);
});

test("browser auth lifecycle clears protected views on sign-out or account change", () => {
  const client = source("lib/supabase.ts");
  assert.match(client, /event === "SIGNED_OUT"/);
  assert.match(client, /window\.location\.replace/);
  assert.match(client, /session\?\.user\.id !== currentAccount/);
  assert.match(client, /window\.location\.reload\(\)/);
  for (const path of ["dashboard", "agent", "knowledge", "billing", "reports", "leads", "appointments"]) assert.ok(client.includes(path));
});
