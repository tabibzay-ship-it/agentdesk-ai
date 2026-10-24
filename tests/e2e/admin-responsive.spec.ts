import { expect, test, type Page } from "@playwright/test";

const widths = [320, 360, 375, 390, 430, 768, 1024, 1440];
const storageKey = "sb-cdynahtkwtcinjzmxjcs-auth-token";

function fakeJwt(payload: Record<string, unknown>) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.synthetic-signature`;
}

async function prepareSyntheticAdmin(page: Page) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "synthetic-admin@example.test",
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const accessToken = fakeJwt({ sub: user.id, aud: "authenticated", role: "authenticated", exp: expiresAt });
  await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), {
    key: storageKey,
    session: { access_token: accessToken, refresh_token: "synthetic-local-refresh", expires_at: expiresAt, expires_in: 3600, token_type: "bearer", user },
  });
  await page.route("**/auth/v1/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) }));
  await page.route("**/api/admin?**", route => {
    const section = new URL(route.request().url()).searchParams.get("section");
    const body = section === "overview"
      ? { stats: { users: 2, agents: 1, activeAgents: 1, conversations: 3, aiResponses: 5, messagesUsed: 7, monthlyCapacity: 250, subscriptions: { free: 2, starter: 0, pro: 0 } } }
      : section === "settings" ? { settings: { paymentsEnabled: false, adminMfaRequired: true }, aiCreditControls: { provider_enabled: true, emergency_shutdown: false, per_user_daily_credit_limit: 250, global_daily_credit_limit: 10000 }, operationCosts: [{ operation: "text_chat", credit_cost: 1 }, { operation: "attachment_analysis", credit_cost: 2 }, { operation: "image_generation", credit_cost: 8 }, { operation: "image_edit", credit_cost: 5 }], writable: true }
      : { rows: [], total: 0 };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

test("credit controls remain usable on a narrow authenticated screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await prepareSyntheticAdmin(page);
  await page.route("**/api/admin", async route => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    expect(body.costs.image_generation).toBe(8);
    expect(body.emergencyShutdown).toBe(true);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ updated: true }) });
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI credit and safety controls" })).toBeVisible();
  await page.getByText("Emergency shutdown").click();
  await page.getByRole("button", { name: "Save audited controls" }).click();
  await expect(page.getByText("AI credit controls saved and audited.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

for (const width of widths) {
  test(`authenticated admin shell is responsive at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await prepareSyntheticAdmin(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Overview", exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.getByRole("button", { name: "Use Dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    if (width < 1024) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("button", { name: "Users", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Users", exact: true }).click();
      await expect(page.getByRole("button", { name: "Close navigation" })).toHaveCount(0);
    }
  });
}
