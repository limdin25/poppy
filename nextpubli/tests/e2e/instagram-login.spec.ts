import { test, expect } from "@playwright/test";

// The Instagram signup/connect flows only exist when the flag is on
// (NEXT_PUBLIC_INSTAGRAM_ENABLED=true — see lib/flags.ts). With Instagram
// hidden, /signup is the email flow covered by email-signup.spec.ts.
const INSTAGRAM_ENABLED = process.env.NEXT_PUBLIC_INSTAGRAM_ENABLED === "true";

test("login page offers email magic-link sign-in", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /get login link/i }),
  ).toBeVisible();
  // No password field — passwordless login.
  await expect(page.getByLabel(/password/i)).toHaveCount(0);
});

test("signup collects name/email/WhatsApp before Instagram, gated by terms", async ({
  page,
}) => {
  test.skip(!INSTAGRAM_ENABLED, "Instagram flows are hidden (lib/flags.ts)");
  await page.goto("/signup");
  await expect(page.getByLabel("First name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Last name")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByText("WhatsApp")).toBeVisible();

  const submit = page.getByRole("button", { name: /sign up with instagram/i });
  await expect(submit).toBeDisabled();

  // Terms open in a popup (not a navigation).
  await page.getByRole("button", { name: /terms of use/i }).click();
  await expect(page.getByRole("dialog")).toContainText(/stories/i);
  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Fill the whole form → submit becomes enabled.
  await page.getByLabel("First name", { exact: true }).fill("Maria");
  await page.getByLabel("Last name").fill("Silva");
  await page.getByLabel("Email", { exact: true }).fill("maria@gmail.com");
  await page.locator('input[type="tel"]').click();
  await page.locator('input[type="tel"]').pressSequentially("11999998888");
  await page.getByRole("checkbox").check();
  await expect(submit).toBeEnabled();

  // The form posts the collected data to the Instagram start route.
  const form = page.locator("form");
  await expect(form).toHaveAttribute("action", "/api/auth/instagram/start");
  await expect(form).toHaveAttribute("method", /post/i);
});

test("terms page explains we publish stories/feed/reels", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: /terms of use/i })).toBeVisible();
  await expect(page.getByText(/stories/i)).toBeVisible();
});

test("start route redirects to Outstand's Instagram OAuth", async ({ page }) => {
  test.skip(!INSTAGRAM_ENABLED, "Instagram flows are hidden (lib/flags.ts)");
  // Don't follow the external redirect — just assert where it points.
  const res = await page.request.get("/api/auth/instagram/start", {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toContain("outstand.so");
});

test("start route is closed while Instagram is hidden", async ({ page }) => {
  test.skip(INSTAGRAM_ENABLED, "Only applies while Instagram is hidden");
  const res = await page.request.get("/api/auth/instagram/start", {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toContain("/login");
});

test("protected route redirects anonymous users to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
