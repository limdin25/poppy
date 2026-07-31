import { test, expect } from "@playwright/test";

// middleware.ts redirects any unauthenticated request on /admin/* to /login.
test("admin notifications page redirects anonymous users to login", async ({ page }) => {
  await page.goto("/admin/notificacoes");
  await expect(page).toHaveURL(/\/login/);
});
