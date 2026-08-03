import { test, expect } from "@playwright/test";

// The Instagram signup/connect flows only exist when the flag is on
// (NEXT_PUBLIC_INSTAGRAM_ENABLED=true, see lib/flags.ts). With Instagram
// hidden, /signup is the email flow covered by email-signup.spec.ts.
const INSTAGRAM_ENABLED = process.env.NEXT_PUBLIC_INSTAGRAM_ENABLED === "true";

test("login page offers email magic-link sign-in", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /get login link/i }),
  ).toBeVisible();
  // No password field. Login is passwordless.
  await expect(page.getByLabel(/password/i)).toHaveCount(0);
});

test("signup is three questions then the Instagram connect screen, gated by terms", async ({
  page,
}) => {
  test.skip(!INSTAGRAM_ENABLED, "Instagram flows are hidden (lib/flags.ts)");
  await page.goto("/signup");

  // Screen 1 of 3: name only. The later questions are not on screen yet.
  await expect(page.getByRole("heading", { name: /what is your name/i })).toBeVisible();
  await expect(page.getByLabel("First name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeHidden();

  // Continue refuses to move on until the question is answered. Matched by text, not
  // by role: Next.js ships its own role="alert" route announcer on every page.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/first and last name/i)).toBeVisible();

  await page.getByLabel("First name", { exact: true }).fill("Maria");
  await page.getByLabel("Last name").fill("Silva");
  await page.getByRole("button", { name: "Continue" }).click();

  // Screen 2 of 3: email.
  await expect(page.getByRole("heading", { name: /what is your email/i })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("maria@gmail.com");
  await page.getByRole("button", { name: "Continue" }).click();

  // Screen 3 of 3: the phone field is Mobile now, never WhatsApp.
  await expect(
    page.getByRole("heading", { name: /what is your mobile number/i }),
  ).toBeVisible();
  await expect(page.getByText("Mobile number", { exact: true })).toBeVisible();
  await expect(page.getByText("WhatsApp")).toHaveCount(0);
  await page.locator('input[type="tel"]').click();
  await page.locator('input[type="tel"]').pressSequentially("11999998888");
  await page.getByRole("button", { name: "Continue" }).click();

  // The Instagram screen explains the deal in three steps before asking for anything.
  await expect(
    page.getByRole("heading", { name: /now connect your instagram/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^1\s*connect your account/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /we post viral content that sells/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /you earn cash and affiliate commission/i }),
  ).toBeVisible();

  const submit = page.getByRole("button", { name: /connect instagram/i });
  await expect(submit).toBeDisabled();

  // Terms open in a popup (not a navigation).
  await page.getByRole("button", { name: /terms of use/i }).click();
  await expect(page.getByRole("dialog")).toContainText(/stories/i);
  await page.getByRole("button", { name: /got it/i }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("checkbox").check();
  await expect(submit).toBeEnabled();

  // Every answer is still in the form, so the POST body is complete even though the
  // three question screens are off screen.
  const form = page.locator("form");
  await expect(form).toHaveAttribute("action", "/api/auth/instagram/start");
  await expect(form).toHaveAttribute("method", /post/i);
  await expect(form.locator('input[name="first_name"]')).toHaveValue("Maria");
  await expect(form.locator('input[name="last_name"]')).toHaveValue("Silva");
  await expect(form.locator('input[name="email"]')).toHaveValue("maria@gmail.com");
  await expect(form.locator('input[name="whatsapp"]')).toHaveValue(/5511999998888/);
});

test("signup stays inside the phone width on the connect screen", async ({ page }) => {
  test.skip(!INSTAGRAM_ENABLED, "Instagram flows are hidden (lib/flags.ts)");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/signup");
  await page.getByLabel("First name", { exact: true }).fill("Maria");
  await page.getByLabel("Last name").fill("Silva");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Email", { exact: true }).fill("maria@gmail.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator('input[type="tel"]').click();
  await page.locator('input[type="tel"]').pressSequentially("11999998888");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: /now connect your instagram/i }),
  ).toBeVisible();

  // The sticky CTA bleeds to the screen edges with -mx-6 px-6; if that ever stops
  // cancelling the page padding the whole page scrolls sideways.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);

  // The button must be reachable without scrolling, which is the point of the sticky bar.
  await expect(page.getByRole("button", { name: /connect instagram/i })).toBeInViewport();
});

test("terms page explains we publish stories/feed/reels", async ({ page }) => {
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: /terms of use/i })).toBeVisible();
  await expect(page.getByText(/stories/i)).toBeVisible();
});

test("start route redirects to Outstand's Instagram OAuth", async ({ page }) => {
  test.skip(!INSTAGRAM_ENABLED, "Instagram flows are hidden (lib/flags.ts)");
  // Don't follow the external redirect, just assert where it points.
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
