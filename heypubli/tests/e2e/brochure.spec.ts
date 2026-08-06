import { test, expect } from "@playwright/test";

/**
 * Smoke spec for the /brochure route.
 *
 * The first test is the one that matters most and it is not about layout. This
 * page prints a creator's own email address, and the repo has already deleted
 * seven pages (heypubli.com/v0 to /v6) for being reachable without a login. If
 * middleware.ts ever loses "/brochure/:path*" from its matcher, that test goes
 * red before anything ships.
 */
test.describe("/brochure", () => {
  test("is not reachable without a login", async ({ page }) => {
    await page.goto("/brochure");
    await expect(page).toHaveURL(/\/login/);
  });

  test("renders at 360px with no sideways scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/brochure");
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

test.describe("/brochure signed in", () => {
  test.skip(!email || !password, "set BROCHURE_TEST_EMAIL and BROCHURE_TEST_PASSWORD");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login?mode=password");
    await page.getByLabel(/email/i).fill(email as string);
    await page.getByLabel(/password/i).fill(password as string);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL(/\/dashboard|\/brochure/);
  });

  test("shows all four steps and a progress count", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/brochure");

    for (const id of ["instagram", "community", "affiliate", "bio"]) {
      await expect(page.getByTestId(`step-${id}`)).toBeVisible();
      await expect(page.getByTestId(`status-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId("brochure-progress")).toContainText("of 4 done");
  });

  test("never scrolls sideways on a 360px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/brochure");
    await page.getByTestId("step-bio").scrollIntoViewIfNeeded();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("refuses a link that is not a Skool link, and says so", async ({ page }) => {
    await page.goto("/brochure");
    await page.getByTestId("skool-link-input").fill("https://notskool.com/me");
    await page.getByTestId("save-skool-link").click();
    await expect(page.getByTestId("skool-link-message")).toContainText("skool.com");
  });

  test("gives the creator a bio sentence they can copy", async ({ page }) => {
    await page.goto("/brochure");
    const sentence = await page.getByTestId("text-bio-sentence").inputValue();
    expect(sentence.length).toBeGreaterThan(20);
    expect(sentence.length).toBeLessThanOrEqual(100);
    await expect(page.getByTestId("copy-bio-sentence")).toBeVisible();
  });
});
