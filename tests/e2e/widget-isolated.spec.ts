import { expect, test } from "@playwright/test";

const agentId = "22222222-2222-4222-8222-222222222222";

for (const viewport of [
  { width: 320, height: 700 },
  { width: 1440, height: 900 },
]) {
  test(`isolated widget is accessible, localized and duplicate-safe at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/widget-settings?**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          agentName: "Synthetic Support",
          welcomeMessage: "ازمایښتي ښه راغلاست",
          primaryColor: "#2563eb",
          isActive: true,
          position: "right",
          size: "standard",
          theme: "light",
          locale: "ps",
        }),
      });
    });
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ reply: "Synthetic response" }),
      });
    });

    await page.goto("/");
    await page.evaluate((id) => {
      const script = document.createElement("script");
      script.src = "/widget.js";
      script.dataset.agentId = id;
      document.body.appendChild(script);
    }, agentId);

    const root = page.locator("#agentdesk-ai-root");
    await expect(root).toHaveCount(1);
    const open = page.getByRole("button", { name: "د AI مرستې خبرې پرانیزئ" });
    await open.click();
    const dialog = page.locator("#agentdesk-ai-window");
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog).toHaveAttribute("aria-label", "Synthetic Support");
    await expect(dialog).toHaveAttribute("dir", "rtl");
    await expect(dialog).toHaveAttribute("aria-hidden", "false");
    await expect(open).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("ازمایښتي ښه راغلاست")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveAttribute("aria-hidden", "true");
    await expect(open).toBeFocused();

    await page.evaluate((id) => {
      const duplicate = document.createElement("script");
      duplicate.src = "/widget.js";
      duplicate.dataset.agentId = id;
      document.body.appendChild(duplicate);
    }, agentId);
    await expect(root).toHaveCount(1);

    await open.click();
    await page.locator("#agentdesk-ai-input").fill("Test question");
    await page.getByRole("button", { name: "ولېږئ" }).click();
    await expect(page.getByText("Synthetic response")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
}
