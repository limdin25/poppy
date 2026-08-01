import { test, expect } from "@playwright/test";

// Email-only signup, the /signup flow while Instagram is hidden
// (NEXT_PUBLIC_INSTAGRAM_ENABLED unset/false, see lib/flags.ts).
const INSTAGRAM_ENABLED = process.env.NEXT_PUBLIC_INSTAGRAM_ENABLED === "true";

test.skip(INSTAGRAM_ENABLED, "Email-only signup only renders while Instagram is hidden");

test("signup page shows the email form with no trace of Instagram", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByLabel("First name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Last name")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByText("WhatsApp")).toBeVisible();
  await expect(page.getByText(/instagram/i)).toHaveCount(0);
});

test("submit stays disabled until WhatsApp and terms are filled", async ({ page }) => {
  await page.goto("/signup");
  const submit = page.getByRole("button", { name: /create my account/i });
  await expect(submit).toBeDisabled();

  await page.getByLabel("First name", { exact: true }).fill("Maria");
  await page.getByLabel("Last name").fill("Silva");
  await page.getByLabel("Email", { exact: true }).fill("maria@gmail.com");
  await page.locator('input[type="tel"]').click();
  await page.locator('input[type="tel"]').pressSequentially("11999998888");
  await page.getByRole("checkbox").check();
  await expect(submit).toBeEnabled();
});

test("terms link opens the /terms page instead of a popup", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("link", { name: /terms of use/i })).toHaveAttribute(
    "href",
    "/terms",
  );
});

test("login page invites signup without mentioning Instagram", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Sign up" })).toBeVisible();
  await expect(page.getByText(/instagram/i)).toHaveCount(0);
});
