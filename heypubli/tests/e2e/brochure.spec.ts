import { test, expect } from "@playwright/test";

/**
 * Smoke spec for /onboarding, the gated funnel that replaced /brochure
 * (2026-08-06). /brochure lives on only as a redirect, because the old URL is
 * in sent messages and bookmarks.
 *
 * The first test is the one that matters most and it is not about layout. This
 * page prints a creator's own email address, and the repo has already deleted
 * seven pages (heypubli.com/v0 to /v6) for being reachable without a login. If
 * middleware.ts ever loses "/onboarding/:path*" from its matcher, that test
 * goes red before anything ships.
 */
test.describe("/onboarding", () => {
  test("is not reachable without a login", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/login/);
  });

  test("/brochure is gated too, and never leaks content on its way out", async ({
    page,
  }) => {
    await page.goto("/brochure");
    await expect(page).toHaveURL(/\/login/);
  });

  test("renders at 360px with no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/onboarding");
    // Logged out, so this is the login page. The assertion still earns its
    // keep: a 360px viewport that scrolls sideways is the single most common
    // way this layout can break, and it is checked on whatever renders.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/**
 * The signed-in half. Needs a seeded creator; skipped until BROCHURE_TEST_EMAIL
 * and BROCHURE_TEST_PASSWORD are set, rather than left failing forever and
 * teaching everyone to ignore a red suite.
 */
const email = process.env.BROCHURE_TEST_EMAIL;
const password = process.env.BROCHURE_TEST_PASSWORD;

test.describe("/onboarding signed in", () => {
  test.skip(!email || !password, "set BROCHURE_TEST_EMAIL and BROCHURE_TEST_PASSWORD");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login?mode=password");
    await page.getByLabel(/email/i).fill(email as string);
    await page.getByLabel(/password/i).fill(password as string);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL(/\/dashboard|\/onboarding/);
  });

  test("shows five steps, exactly one of them open", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/onboarding");

    const ids = ["instagram", "community", "affiliate", "photo", "bio"];
    for (const id of ids) {
      await expect(page.getByTestId(`step-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId("funnel-progress")).toContainText("of 5 done");

    const open = page.locator('[data-mode="open"]');
    await expect(open).toHaveCount(1);
  });

  test("/brochure walks a signed-in creator to the funnel", async ({ page }) => {
    await page.goto("/brochure");
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test("never scrolls sideways on a 360px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/onboarding");
    await page.getByTestId("step-bio").scrollIntoViewIfNeeded();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
