import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const enabled = process.env.AUTH_E2E_LOCAL === "1";
const baseURL = process.env.AUTH_E2E_BASE_URL ?? "http://127.0.0.1:3300";
const supabaseURL = process.env.AUTH_E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const anonKey = process.env.AUTH_E2E_SUPABASE_ANON_KEY ?? "";
const mailpitURL = process.env.AUTH_E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const screenshotDir = path.resolve("test-results", "auth-local-live");

test.describe("real local Supabase authentication", () => {
  test.skip(!enabled, "Requires the explicitly isolated localhost-only Supabase stack.");
  test.describe.configure({ mode: "serial" });

  test("complete two-account authentication and recovery lifecycle", async ({ page, browser, request }) => {
    // This deliberately waits through token refresh, global session revocation,
    // and OTP expiry windows. Leave headroom for slower Windows CI hosts.
    test.setTimeout(900_000);
    expect(anonKey, "The disposable local anon key is required.").not.toBe("");
    await mkdir(screenshotDir, { recursive: true });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const accountA = `auth-a-${suffix}@example.test`;
    const accountB = `auth-b-${suffix}@example.test`;
    const initialPassword = "InitialPass123!";
    const replacementPassword = "ReplacementPass456!";
    const checkpoint = (name: string) => console.log(`[auth-e2e] ${name}`);
    const browserErrors: string[] = [];
    const authRequestPaths: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text().slice(0, 300));
    });
    page.on("request", (request) => {
      if (request.url().startsWith(supabaseURL)) authRequestPaths.push(new URL(request.url()).pathname);
    });
    page.on("requestfailed", (request) => {
      if (request.url().startsWith(supabaseURL)) {
        authRequestPaths.push(`${new URL(request.url()).pathname}:failed:${request.failure()?.errorText ?? "unknown"}`);
      }
    });

    async function latestMailLink(address: string, subject: RegExp) {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const listing = await request.get(`${mailpitURL}/api/v1/messages?limit=100`);
        expect(listing.ok()).toBe(true);
        const body = await listing.json() as {
          messages?: Array<{ ID: string; To?: Array<{ Address?: string }> | { Address?: string }; Subject?: string }>;
        };
        const message = body.messages?.find((candidate) =>
          (Array.isArray(candidate.To) ? candidate.To : [candidate.To])
            .some((recipient) => recipient?.Address === address) &&
          subject.test(candidate.Subject ?? ""));
        if (message) {
          const detailResponse = await request.get(`${mailpitURL}/api/v1/message/${message.ID}`);
          expect(detailResponse.ok()).toBe(true);
          const detail = await detailResponse.json() as { Text?: string; HTML?: string };
          const content = `${detail.Text ?? ""}\n${detail.HTML ?? ""}`.replaceAll("&amp;", "&");
          const link = content.match(/https?:\/\/[^\s<>"']*\/auth\/v1\/verify[^\s<>"']*/)?.[0];
          if (link) return link;
        }
        await page.waitForTimeout(250);
      }
      throw new Error(`No matching local email arrived for ${address}.`);
    }

    async function latestMailCode(address: string, subject: RegExp) {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const listing = await request.get(`${mailpitURL}/api/v1/messages?limit=100`);
        expect(listing.ok()).toBe(true);
        const body = await listing.json() as {
          messages?: Array<{ ID: string; To?: Array<{ Address?: string }> | { Address?: string }; Subject?: string }>;
        };
        const message = body.messages?.find((candidate) =>
          (Array.isArray(candidate.To) ? candidate.To : [candidate.To])
            .some((recipient) => recipient?.Address === address) &&
          subject.test(candidate.Subject ?? ""));
        if (message) {
          const detailResponse = await request.get(`${mailpitURL}/api/v1/message/${message.ID}`);
          expect(detailResponse.ok()).toBe(true);
          const detail = await detailResponse.json() as { Text?: string; HTML?: string };
          const code = `${detail.Text ?? ""}\n${detail.HTML ?? ""}`.match(/\b\d{6}\b/)?.[0];
          if (code) return code;
        }
        await page.waitForTimeout(250);
      }
      throw new Error(`No matching local recovery code arrived for ${address}.`);
    }

    async function enterRecoveryCode(target: typeof page, code: string) {
      for (let index = 0; index < 6; index += 1) {
        await target.getByLabel(`Verification code digit ${index + 1}`).fill(code[index]);
      }
      await target.getByRole("button", { name: "Verify Code" }).click();
    }

    async function registerAndConfirm(email: string, name: string) {
      checkpoint(`register ${name}`);
      await page.goto(`${baseURL}/register`);
      await page.getByLabel("Full name").fill(name);
      await page.getByLabel("Email address").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(initialPassword);
      await page.getByLabel("Confirm password").fill(initialPassword);

      let signupRequests = 0;
      let signupURL = "";
      const countSignup = (req: { url(): string }) => {
        if (req.url().includes("/auth/v1/signup")) {
          signupRequests += 1;
          signupURL = req.url();
        }
      };
      page.on("request", countSignup);
      const submit = page.getByRole("button", { name: "Create Free Account" });
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(page.locator('[role="status"], [role="alert"]:not(#__next-route-announcer__)').first())
        .toBeVisible({ timeout: 20_000 });
      if (await page.locator('[role="alert"]:not(#__next-route-announcer__)').isVisible()) {
        throw new Error(`Synthetic signup failed: ${JSON.stringify({ signupRequests, authRequestPaths, browserErrors })}`);
      }
      expect(signupRequests).toBe(1);
      expect(new URL(signupURL).origin).toBe(new URL(supabaseURL).origin);
      await expect(page.getByRole("status")).toContainText("check your email", {
        ignoreCase: true,
        timeout: 15_000,
      });
      expect(signupRequests).toBe(1);
      page.off("request", countSignup);

      const confirmationLink = new URL(await latestMailLink(email, /confirm|signup/i));
      // The experimental stack bakes its transient API proxy port into signup
      // emails. Route that loopback-only link through the verified test proxy.
      if (["127.0.0.1", "localhost"].includes(confirmationLink.hostname)) {
        const verifiedOrigin = new URL(supabaseURL);
        confirmationLink.protocol = verifiedOrigin.protocol;
        confirmationLink.host = verifiedOrigin.host;
      }
      await page.goto(confirmationLink.toString());
      // GoTrue first redirects to /login with a session fragment. The login
      // page then finishes session recovery and redirects to the dashboard.
      try {
        await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
      } catch {
        const safeLocation = await page.evaluate(() => {
          const current = new URL(window.location.href);
          return {
            path: current.pathname,
            queryKeys: [...current.searchParams.keys()],
            fragmentKeys: [...new URLSearchParams(current.hash.slice(1)).keys()],
          };
        });
        const visibleError = await page.locator('[role="alert"]:not(#__next-route-announcer__)').textContent().catch(() => null);
        throw new Error(`Confirmation did not complete: ${JSON.stringify({ safeLocation, visibleError })}`);
      }
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/login/);
      checkpoint(`confirmed ${name}`);
    }

    async function login(email: string, password: string) {
      await page.goto(`${baseURL}/login`);
      await page.getByLabel("Email address").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign In", exact: true }).click();
    }

    await registerAndConfirm(accountA, "Synthetic Account A");
    await registerAndConfirm(accountB, "Synthetic Account B");
    checkpoint("both accounts confirmed");

    await login(accountA, "WrongPassword123!");
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(
      "Could not sign in",
      { timeout: 15_000 },
    );
    await login(accountA, initialPassword);
    await page.waitForURL(/\/dashboard/);
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.screenshot({ path: `${screenshotDir}/authenticated-dashboard.png`, fullPage: true });

    const browserSession = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("sb-") && item.endsWith("-auth-token"));
      if (!key) return null;
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
      return stored.access_token && stored.refresh_token
        ? { access_token: stored.access_token as string, refresh_token: stored.refresh_token as string }
        : null;
    });
    expect(browserSession).not.toBeNull();
    const sessionClient = createClient(supabaseURL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const restored = await sessionClient.auth.setSession(browserSession!);
    expect(restored.error).toBeNull();
    const refreshed = await sessionClient.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    expect(refreshed.data.session?.access_token).toBeTruthy();
    expect(refreshed.data.session?.access_token).not.toBe(browserSession!.access_token);
    checkpoint("session refreshed");

    const refreshTokenBeforeRevocation = refreshed.data.session!.refresh_token;
    expect((await sessionClient.auth.signOut({ scope: "global" })).error).toBeNull();
    const revokedClient = createClient(supabaseURL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const revokedRefresh = await revokedClient.auth.refreshSession({
      refresh_token: refreshTokenBeforeRevocation,
    });
    expect(revokedRefresh.error).not.toBeNull();
    checkpoint("global revocation verified");
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${baseURL}/login`);
    checkpoint("fresh login page opened after revocation");

    await page.goto(`${baseURL}/forgot-password`);
    checkpoint("recovery request page opened");
    await page.getByLabel("Email address").fill(accountA);
    await page.getByRole("button", { name: "Send Verification Code" }).click();
    await page.waitForURL(/\/verify-reset-code/);
    checkpoint("recovery code requested");
    const recoveryCode = await latestMailCode(accountA, /reset|recover|password/i);
    await enterRecoveryCode(page, recoveryCode);
    await page.waitForURL(/\/reset-password/);
    checkpoint("recovery code verified");
    await expect(page.getByRole("button", { name: "Reset Password" })).toBeEnabled({ timeout: 10_000 });
    await page.getByLabel("New Password", { exact: true }).fill(replacementPassword);
    await page.getByLabel("Confirm New Password", { exact: true }).fill(replacementPassword);
    await page.screenshot({ path: `${screenshotDir}/recovery-ready.png`, fullPage: true });
    await page.getByRole("button", { name: "Reset Password" }).click();
    await page.waitForURL(/\/login\?reset=success/);
    checkpoint("password recovery completed");

    await login(accountA, initialPassword);
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText(
      "Could not sign in",
      { timeout: 15_000 },
    );
    await login(accountA, replacementPassword);
    await page.waitForURL(/\/dashboard/);
    await page.getByRole("button", { name: "Sign out" }).click();

    const reused = await browser.newContext();
    const reusedPage = await reused.newPage();
    await reusedPage.goto(`${baseURL}/verify-reset-code`);
    await reusedPage.evaluate((email) => sessionStorage.setItem("agentdesk-recovery-email", email), accountA);
    await reusedPage.reload();
    await enterRecoveryCode(reusedPage, recoveryCode);
    await expect(reusedPage.getByText(/incorrect, expired, or has already been used/i)).toBeVisible();
    await reused.close();

    await page.evaluate(() => localStorage.clear());
    await page.goto(`${baseURL}/forgot-password`);
    await page.getByLabel("Email address").fill(accountB);
    await page.getByRole("button", { name: "Send Verification Code" }).click();
    const expiringCode = await latestMailCode(accountB, /reset|recover|password/i);
    await page.waitForTimeout(17_000);
    const expired = await browser.newContext();
    const expiredPage = await expired.newPage();
    await expiredPage.goto(`${baseURL}/verify-reset-code`);
    await expiredPage.evaluate((email) => sessionStorage.setItem("agentdesk-recovery-email", email), accountB);
    await expiredPage.reload();
    await enterRecoveryCode(expiredPage, expiringCode);
    await expect(expiredPage.getByText(/incorrect, expired, or has already been used/i)).toBeVisible();
    await expired.close();

    await page.evaluate(() => localStorage.clear());
    await page.goto(`${baseURL}/forgot-password`);
    await page.getByLabel("Email address").fill(`missing-${suffix}@example.test`);
    await page.getByRole("button", { name: "Send Verification Code" }).click();
    await page.waitForURL(/\/verify-reset-code/);
    await expect(page.getByRole("status")).toContainText("If an account exists");

    await page.evaluate(() => localStorage.clear());
    await page.goto(`${baseURL}/forgot-password`);
    await page.getByLabel("Email address").fill(accountB);
    await page.getByRole("button", { name: "Send Verification Code" }).click();
    await page.waitForURL(/\/verify-reset-code/);
    await expect(page.getByRole("button", { name: /Resend available in/ })).toBeDisabled();

    const clientA = createClient(supabaseURL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const clientB = createClient(supabaseURL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const aSession = await clientA.auth.signInWithPassword({ email: accountA, password: replacementPassword });
    const bSession = await clientB.auth.signInWithPassword({ email: accountB, password: initialPassword });
    expect(aSession.error).toBeNull();
    expect(bSession.error).toBeNull();
    const userA = aSession.data.user?.id;
    const userB = bSession.data.user?.id;
    expect(userA).toBeTruthy();
    expect(userB).toBeTruthy();
    expect(userA).not.toBe(userB);
    checkpoint("distinct account identities verified");

    const inserted = await clientA.from("business_profiles").insert({
      user_id: userA,
      business_name: "Synthetic A Private Profile",
      description: "isolation sentinel",
      email: accountA,
    }).select("id").single();
    expect(inserted.error).toBeNull();
    const bReadA = await clientB.from("business_profiles").select("id").eq("user_id", userA);
    expect(bReadA.error).toBeNull();
    expect(bReadA.data).toEqual([]);
    const bWriteA = await clientB.from("business_profiles").insert({
      user_id: userA,
      business_name: "Forbidden cross-account write",
    });
    expect(bWriteA.error).not.toBeNull();
    checkpoint("two-account RLS isolation verified");

    const unauthenticated = await browser.newContext();
    const anonymousPage = await unauthenticated.newPage();
    await anonymousPage.goto(`${baseURL}/dashboard`);
    await anonymousPage.waitForURL(/\/login/);
    await expect(anonymousPage.getByText("Synthetic A Private Profile")).toHaveCount(0);
    await unauthenticated.close();

    await clientA.auth.signOut({ scope: "global" });
    await clientB.auth.signOut({ scope: "global" });
  });
});
