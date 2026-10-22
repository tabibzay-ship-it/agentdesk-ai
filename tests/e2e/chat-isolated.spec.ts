import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const enabled = process.env.CHAT_E2E_LOCAL === "1";
const appURL = process.env.CHAT_E2E_BASE_URL ?? "http://127.0.0.1:3400";
const supabaseURL = process.env.CHAT_E2E_SUPABASE_URL ?? "http://127.0.0.1:55421";
const anonKey = process.env.CHAT_E2E_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.CHAT_E2E_SUPABASE_SERVICE_KEY ?? "";
const password = "SyntheticOnlyPass123!";

test.describe("isolated authenticated chat workflow", () => {
  test.skip(!enabled, "Requires the verified localhost-only disposable stack.");
  test.describe.configure({ mode: "serial" });

  test("upload, mock analysis, revisions, export, download, re-upload and tenant isolation", async ({ page, browser, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "This controlled local run uses Chromium.");
    expect(anonKey).not.toBe("");
    expect(serviceKey).not.toBe("");
    const admin = createClient(supabaseURL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const suffix = `${Date.now()}-${testInfo.project.name}`;
    const emails = [`chat-a-${suffix}@example.test`, `chat-b-${suffix}@example.test`];
    const created: string[] = [];

    async function createSynthetic(email: string) {
      let result = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Synthetic E2E" } });
      for (let attempt = 1; result.error?.name === "AuthRetryableFetchError" && attempt < 3; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
        result = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Synthetic E2E" } });
      }
      expect(result.error).toBeNull();
      const id = result.data.user!.id;
      created.push(id);
      const publicAgentId = crypto.randomUUID();
      expect((await admin.from("agent_settings").insert({ user_id: id, public_agent_id: publicAgentId, tone: "professional", custom_instructions: "Only process synthetic E2E content.", allowed_domains: ["127.0.0.1"], is_active: true })).error).toBeNull();
      expect((await admin.from("widget_settings").insert({ user_id: id, agent_name: "Synthetic Agent", welcome_message: "Synthetic chat ready" })).error).toBeNull();
      expect((await admin.from("usage_limits").upsert({ user_id: id, plan: "free", monthly_limit: 50, messages_used: 0, period_start: new Date().toISOString().slice(0, 10) })).error).toBeNull();
      return { id, publicAgentId, email };
    }

    async function login(target: Page, email: string) {
      await target.goto(`${appURL}/login`);
      await target.getByLabel("Email address").fill(email);
      await target.getByLabel("Password", { exact: true }).fill(password);
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        await target.getByRole("button", { name: "Sign In", exact: true }).click();
        try {
          await target.waitForURL(/\/dashboard/, { timeout: 30_000 });
          break;
        } catch {
          if (attempt === 2) {
            const message = await target.locator('[role="alert"]:not(#__next-route-announcer__)').textContent().catch(() => null);
            throw new Error(`Synthetic login did not complete${message ? `: ${message}` : "."}`);
          }
          await target.waitForTimeout(2_000);
          await target.getByLabel("Email address").fill(email);
          await target.getByLabel("Password", { exact: true }).fill(password);
        }
      }
      await expect(target.getByText(/Welcome back,/).first()).toBeVisible({ timeout: 60_000 });
      await target.goto(`${appURL}/chat`);
      await expect(target.getByText("Synthetic chat ready")).toBeVisible({ timeout: 30_000 });
    }

    async function tokenFrom(target: Page) {
      return target.evaluate(() => {
        const key = Object.keys(localStorage).find((item) => item.startsWith("sb-") && item.endsWith("-auth-token"));
        if (!key) return "";
        return JSON.parse(localStorage.getItem(key) ?? "{}").access_token as string || "";
      });
    }

    let accountA: Awaited<ReturnType<typeof createSynthetic>> | undefined;
    let accountB: Awaited<ReturnType<typeof createSynthetic>> | undefined;
    let contextB: BrowserContext | undefined;
    try {
      accountA = await createSynthetic(emails[0]);
      accountB = await createSynthetic(emails[1]);
      await login(page, accountA.email);
      const tokenA = await tokenFrom(page);
      expect(tokenA).not.toBe("");

      const retryRequestId = crypto.randomUUID();
      const retryVisitorId = `dashboard-test-${crypto.randomUUID()}`;
      const retryPayload = { message: "IDEMPOTENCY_CONCURRENCY_CHECK", agentId: accountA.publicAgentId, visitorId: retryVisitorId, requestId: retryRequestId };
      const retryHeaders = { Authorization: `Bearer ${tokenA}`, Origin: appURL };
      const attempts = await Promise.all([
        page.request.post(`${appURL}/api/chat`, { headers: retryHeaders, data: retryPayload }),
        page.request.post(`${appURL}/api/chat`, { headers: retryHeaders, data: retryPayload }),
      ]);
      expect(attempts.map(response => response.status()).sort()).toEqual([200, 409]);
      const replay = await page.request.post(`${appURL}/api/chat`, { headers: retryHeaders, data: retryPayload });
      expect(replay.status()).toBe(200);
      expect((await replay.json()).replayed).toBe(true);
      const { data: retryConversation } = await admin.from("conversations").select("id").eq("user_id", accountA.id).eq("visitor_id", retryVisitorId).single();
      const { count: retryMessageCount } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", retryConversation!.id);
      expect(retryMessageCount).toBe(2);

      const source = Buffer.from("Synthetic file only. Unique fact: SYNTHETIC_ATTACHMENT_MARKER_55421.\n");
      await page.locator('input[type="file"]').nth(1).setInputFiles({ name: "synthetic-source.txt", mimeType: "text/plain", buffer: source });
      await expect(page.getByText("synthetic-source.txt")).toBeVisible();
      await expect(page.locator("form").getByText("Ready", { exact: true })).toBeVisible({ timeout: 60_000 });
      await page.getByPlaceholder("Message your AI agent").fill("Analyze the attached synthetic file.");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText("MOCK_ANALYSIS_CONFIRMED: SYNTHETIC_ATTACHMENT_MARKER_55421")).toBeVisible({ timeout: 30_000 });

      await page.getByPlaceholder("Message your AI agent").fill("FIRST_REVISION_REQUEST");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText("FIRST_REVISION_COMPLETE: The synthetic source was revised safely.")).toBeVisible({ timeout: 30_000 });

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "txt", exact: true }).last().click();
      const download = await downloadPromise;
      const downloadedPath = await download.path();
      expect(downloadedPath).toBeTruthy();
      const suggested = download.suggestedFilename();
      expect(suggested).toMatch(/\.txt$/);

      await page.locator('input[type="file"]').nth(1).setInputFiles({
        name: suggested,
        mimeType: "text/plain",
        buffer: await readFile(downloadedPath!),
      });
      await expect(page.locator("form").getByText(suggested)).toBeVisible();
      await expect(page.locator("form").getByText("Ready", { exact: true })).toBeVisible({ timeout: 60_000 });
      await page.getByPlaceholder("Message your AI agent").fill("SECOND_REVISION_REQUEST");
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.getByText("SECOND_REVISION_COMPLETE: The exported result was re-uploaded and revised again.").first()).toBeVisible({ timeout: 30_000 });

      const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#2563eb" } }).png().toBuffer();
      await page.locator('input[type="file"]').first().setInputFiles({ name: "synthetic-image.png", mimeType: "image/png", buffer: png });
      await expect(page.getByText("synthetic-image.png")).toBeVisible();
      await expect(page.locator("form").getByText("Ready", { exact: true })).toBeVisible({ timeout: 60_000 });
      await page.getByPlaceholder("Message your AI agent").fill("Analyze this synthetic image.");
      const sendImage = page.getByRole("button", { name: "Send message" });
      await sendImage.click();
      await expect(page.getByPlaceholder("Message your AI agent")).toBeEnabled({ timeout: 60_000 });
      await expect(page.getByRole("button", { name: "Edit image" }).last()).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Edit image" }).last().click();
      await page.getByRole("button", { name: "Create edited copy" }).click();
      await expect(page.getByText(/Image edit completed \(grayscale\)/).last()).toBeVisible({ timeout: 90_000 });

      await page.reload();
      await expect(page.getByText("SECOND_REVISION_COMPLETE: The exported result was re-uploaded and revised again.").first()).toBeVisible({ timeout: 30_000 });

      const responsiveRoutes = ["/dashboard", "/agent", "/chat", "/conversations", "/knowledge", "/billing", "/settings", "/leads", "/appointments"];
      for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of responsiveRoutes) {
          await page.goto(`${appURL}${route}`);
          await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
          const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
          expect(overflow.scroll - overflow.client, `${route} overflowed at ${width}px`).toBeLessThanOrEqual(1);
        }
      }
      await page.setViewportSize({ width: 1280, height: 900 });

      await page.goto(`${appURL}/knowledge`);
      await page.getByLabel("Knowledge title").fill("Synthetic isolation source");
      await page.getByLabel("Information").fill("SYNTHETIC_KNOWLEDGE_ONLY_ACCOUNT_A");
      await page.getByRole("button", { name: "Add to Knowledge Base" }).click();
      await expect(page.getByRole("status")).toContainText("Knowledge added successfully", { timeout: 15_000 });
      await page.reload();
      await expect(page.getByText("Synthetic isolation source")).toBeVisible({ timeout: 15_000 });

      const { data: aFiles } = await admin.from("chat_attachments").select("id,conversation_id,user_id").eq("user_id", accountA.id).limit(20);
      expect(aFiles?.length).toBeGreaterThanOrEqual(4);
      const aAttachmentId = aFiles![0].id;
      const { data: aMessages } = await admin.from("messages").select("id,conversation_id,role").in("conversation_id", [...new Set(aFiles!.map((item) => item.conversation_id).filter(Boolean))]);
      const assistantA = aMessages?.find((item) => item.role === "assistant");
      expect(assistantA).toBeTruthy();

      contextB = await browser.newContext();
      const pageB = await contextB.newPage();
      await login(pageB, accountB.email);
      const tokenB = await tokenFrom(pageB);
      const crossTenantReplay = await pageB.request.post(`${appURL}/api/chat`, { headers: { Authorization: `Bearer ${tokenB}`, Origin: appURL }, data: { ...retryPayload, agentId: accountB.publicAgentId, visitorId: `dashboard-test-${crypto.randomUUID()}` } });
      expect(crossTenantReplay.status()).toBe(409);
      const forbiddenDownload = await pageB.request.get(`${appURL}/api/chat/attachments/${aAttachmentId}`, { headers: { Authorization: `Bearer ${tokenB}`, Origin: appURL } });
      expect([403, 404]).toContain(forbiddenDownload.status());
      const forbiddenExport = await pageB.request.post(`${appURL}/api/chat/exports`, { headers: { Authorization: `Bearer ${tokenB}`, Origin: appURL }, data: { messageId: assistantA!.id, format: "txt" } });
      expect(forbiddenExport.status()).toBe(404);
      const { data: bFiles } = await admin.from("chat_attachments").select("id").eq("user_id", accountB.id);
      expect(bFiles).toHaveLength(0);

      await page.goto(`${appURL}/conversations`);
      await expect(page.getByText("SECOND_REVISION_COMPLETE: The exported result was re-uploaded and revised again.").first()).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "Rename" }).click();
      await page.getByLabel("Conversation title").fill("Synthetic persistent history");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("heading", { name: "Synthetic persistent history" })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name: "Synthetic persistent history" })).toBeVisible({ timeout: 20_000 });
      await page.getByLabel("Search conversations").fill("persistent history");
      await expect(page.getByRole("button", { name: /Synthetic persistent history/ })).toBeVisible();
      await page.getByRole("button", { name: "Delete" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.getByRole("button", { name: "Delete conversation" }).click();
      // The earlier idempotency scenario intentionally leaves a second
      // conversation. With the search still applied, deleting the renamed
      // conversation must therefore produce an empty filtered result.
      await expect(page.getByText("No matching conversations")).toBeVisible({ timeout: 20_000 });

      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter(element => {
            const bounds = element.getBoundingClientRect();
            return bounds.right > root.clientWidth + 1 || bounds.left < -1;
          })
          .slice(0, 8)
          .map(element => ({ tag: element.tagName, id: element.id, className: element.className, bounds: element.getBoundingClientRect().toJSON() }));
        return { pixels: root.scrollWidth - root.clientWidth, offenders };
      });
      expect(overflow.pixels, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(1);
      await page.goto(`${appURL}/dashboard`);
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/login/);
      await expect(page).toHaveURL(/\/login/);
    } finally {
      if (contextB) await contextB.close();
      for (const id of created.reverse()) await admin.auth.admin.deleteUser(id);
    }
  });
});
