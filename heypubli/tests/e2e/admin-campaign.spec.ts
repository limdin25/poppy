import { test, expect } from "@playwright/test";

// /admin/campaign is admin-only: the middleware sends anonymous visitors to /login.
test("campaign page requires login", async ({ page }) => {
  await page.goto("/admin/campaign");
  await expect(page).toHaveURL(/\/login/);
});
