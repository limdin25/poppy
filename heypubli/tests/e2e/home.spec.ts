import { test, expect } from "@playwright/test";

test("home page loads the landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Monetize seu talento e ganhe com")).toBeVisible();
  await expect(page.getByRole("link", { name: "Entrar" })).toBeVisible();
});
