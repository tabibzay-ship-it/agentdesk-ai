import { expect, test } from "@playwright/test";

const widths = [320, 360, 375, 390, 430, 768, 1024, 1440];
const pages = ["/login", "/register", "/forgot-password", "/verify-reset-code", "/reset-password", "/admin/login", "/admin/reset-password"];

for (const width of widths) {
  test(`auth pages remain accessible without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of pages) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow, `${path} overflowed at ${width}px`).toBe(false);
      for (const control of await page.locator("input, button, select, a").all()) {
        if (await control.isVisible()) {
          const box = await control.boundingBox();
          if (box) expect(box.width).toBeGreaterThanOrEqual(24);
        }
      }
    }
  });
}

test("English-only UI and theme preferences persist across auth navigation", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("combobox", { name: "Language" })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Use Dark theme" }).click();
  await page.goto("/forgot-password");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("agentdesk-theme"))).toBe("dark");
  await page.getByRole("button", { name: "Use Light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Use System theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("agentdesk-theme"))).toBe("system");
});

test("forms expose keyboard-focusable labels, validation and recovery fail-closed state", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email address")).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  await page.goto("/register");
  await expect(page.getByLabel("Confirm password")).toHaveAttribute("autocomplete", "new-password");
  await page.goto("/reset-password");
  await expect(page.getByRole("button", { name: "Reset Password" })).toBeDisabled();
  await expect(page.getByText(/recovery authorization is invalid or expired/i)).toBeVisible();
});

test("recovery code entry supports six digits and paste without exposing the email", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.evaluate(() => sessionStorage.setItem("agentdesk-recovery-email", "synthetic@example.test"));
  await page.goto("/verify-reset-code");
  const firstDigit = page.getByLabel("Verification code digit 1");
  await expect(firstDigit).toBeVisible();
  await firstDigit.focus();
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Verification code digit 1"]');
    const clipboardData = new DataTransfer();
    clipboardData.setData("text", "123456");
    input?.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      clipboardData,
    }));
  });
  for (let index = 1; index <= 6; index += 1) {
    await expect(page.getByLabel(`Verification code digit ${index}`)).toHaveValue(String(index));
  }
  await expect(page.getByRole("button", { name: "Verify Code" })).toBeEnabled();
  await expect(page).not.toHaveURL(/synthetic%40example\.test/);
});

test("unsafe post-login destinations are never preserved by the login UI", async ({ page }) => {
  await page.goto("/login?next=https://evil.example");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("form")).toBeVisible();
  expect(await page.locator("a").evaluateAll(nodes => nodes.some(node => (node as HTMLAnchorElement).href.includes("evil.example")))).toBe(false);
});

test("forgot-password remains enumeration-safe on success and handles network failure", async ({ page }) => {
  await page.route("**/auth/v1/recover*", async route => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill("unknown@example.test");
  await page.getByRole("button", { name: "Send Reset Link" }).click();
  await expect(page.getByRole("status")).toHaveText("If an account exists for this email, you will receive a password reset link.");
  await page.evaluate(() => localStorage.removeItem("agentdesk-password-recovery-cooldown"));
  await page.reload();
  await page.unroute("**/auth/v1/recover*");
  await page.route("**/auth/v1/recover*", async route => route.abort("internetdisconnected"));
  await page.getByLabel("Email address").fill("person@example.test");
  await page.getByRole("button", { name: "Send Reset Link" }).click();
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText("Check your connection");
});
