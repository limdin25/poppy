import { test, expect } from "@playwright/test";

// /admin/campanha is admin-only: the middleware sends anonymous visitors to /login.
test("campanha page requires login", async ({ page }) => {
  await page.goto("/admin/campanha");
  await expect(page).toHaveURL(/\/login/);
});
