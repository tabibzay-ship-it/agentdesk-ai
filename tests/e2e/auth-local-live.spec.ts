import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdir } from "node:fs/promises";

const enabled = process.env.AUTH_E2E_LOCAL === "1";
const baseURL = process.env.AUTH_E2E_BASE_URL ?? "http://127.0.0.1:3300";
const supabaseURL = process.env.AUTH_E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const anonKey = process.env.AUTH_E2E_SUPABASE_ANON_KEY ?? "";
const mailpitURL = process.env.AUTH_E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";
const screenshotDir = "D:/AgentDesk-Supabase-Tools/auth-e2e-runtime/screenshots";

test.describe("real local Supabase authentication", () => {
  test.skip(!enabled, "Requires the explicitly isolated localhost-only Supabase stack.");
  test.describe.configure({ mode: "serial" });

  test("complete two-account authentication and recovery lifecycle", async ({ page, browser, request }) => {
    test.setTimeout(380_000);
    expect(anonKey, "The disposable local anon key is required.").not.toBe("");
    await mkdir(screenshotDir, { recursive: true });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const accountA = `auth-a-${suffix}@example.test`;
    const accountB = `auth-b-${suffix}@example.test`;
    const initialPassword = "InitialPass123!";
    const replacementPassword = "ReplacementPass456!";

    async function latestMailLink(address: string, subject: RegExp) {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        const listing = await request.get(`${mailpitURL}/api/v1/messages?limit=100`);
        expect(listing.ok()).toBe(true);
        const body = await listing.json() as {
          messages?: Array<{ ID: string; To?: Array<{ Address?: string }>; Subject?: string }>;
        };
        const message = body.messages?.find((candidate) =>
          candidate.To?.some((recipient) => recipient.Address === address) &&
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
          messages?: Array<{ ID: string; To?: Array<{ Address?: string }>; Subject?: string }>;
        };
        const message = body.messages?.find((candidate) =>
          candidate.To?.some((recipient) => recipient.Address === address) &&
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
      await page.goto(`${baseURL}/register`);
      await page.getByLabel("Full name").fill(name);
      await page.getByLabel("Email address").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(initialPassword);
      await page.getByLabel("Confirm password").fill(initialPassword);

      let signupRequests = 0;
      const countSignup = (req: { url(): string }) => {
        if (req.url().includes("/auth/v1/signup")) signupRequests += 1;
      };
      page.on("request", countSignup);
      const submit = page.getByRole("button", { name: "Create Free Account" });
      await submit.dblclick();
      await expect(page.getByRole("status")).toContainText("check your email", {
        ignoreCase: true,
        timeout: 15_000,
      });
      expect(signupRequests).toBe(1);
      page.off("request", countSignup);

      const confirmationLink = await latestMailLink(email, /confirm|signup/i);
      await page.goto(confirmationLink);
      // GoTrue first redirects to /login with a session fragment. The login
      // page then finishes session recovery and redirects to the dashboard.
      await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/login/);
    }

    async function login(email: string, password: string) {
      await page.goto(`${baseURL}/login`);
      await page.getByLabel("Email address").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign In", exact: true }).click();
    }

    await registerAndConfirm(accountA, "Synthetic Account A");
    await registerAndConfirm(accountB, "Synthetic Account B");

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

    const tokenBeforeRefresh = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("sb-") && item.endsWith("-auth-token"));
      if (!key) return "";
      return JSON.parse(localStorage.getItem(key) ?? "{}").access_token ?? "";
    });
    expect(tokenBeforeRefresh).not.toBe("");
    await page.waitForTimeout(70_000);
    const tokenAfterRefresh = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("sb-") && item.endsWith("-auth-token"));
      if (!key) return "";
      return JSON.parse(localStorage.getItem(key) ?? "{}").access_token ?? "";
    });
    expect(tokenAfterRefresh).not.toBe("");
    expect(tokenAfterRefresh).not.toBe(tokenBeforeRefresh);

    const browserSession = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((item) => item.startsWith("sb-") && item.endsWith("-auth-token"));
      if (!key) return null;
      const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
      return stored.access_token && stored.refresh_token
        ? { access_token: stored.access_token as string, refresh_token: stored.refresh_token as string }
        : null;
    });
    expect(browserSession).not.toBeNull();
    const revoker = createClient(supabaseURL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const restored = await revoker.auth.setSession(browserSession!);
    expect(restored.error).toBeNull();
    expect((await revoker.auth.signOut({ scope: "global" })).error).toBeNull();
    await page.waitForTimeout(65_000);
    await page.goto(`${baseURL}/dashboard`);
    await page.waitForURL(/\/login/);

    await page.goto(`${baseURL}/forgot-password`);
    await page.getByLabel("Email address").fill(accountA);
    await page.getByRole("button", { name: "Send Verification Code" }).click();
    await page.waitForURL(/\/verify-reset-code/);
    const recoveryCode = await latestMailCode(accountA, /reset|recover|password/i);
    await enterRecoveryCode(page, recoveryCode);
    await page.waitForURL(/\/reset-password/);
    await expect(page.getByRole("button", { name: "Reset Password" })).toBeEnabled({ timeout: 10_000 });
    await page.getByLabel("New password").fill(replacementPassword);
    await page.getByLabel("Confirm new password").fill(replacementPassword);
    await page.screenshot({ path: `${screenshotDir}/recovery-ready.png`, fullPage: true });
    await page.getByRole("button", { name: "Reset Password" }).click();
    await page.waitForURL(/\/login\?reset=success/);

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

    await page.goto(`${baseURL}/forgot-password`);
    await page.getByLabel("Email address").fill(`missing-${suffix}@example.test`);
    await page.getByRole("button", { name: "Send Verification Code" }).click();
    await page.waitForURL(/\/verify-reset-code/);
    await expect(page.getByRole("status")).toContainText("If an account exists");

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
