import { test, expect } from "@playwright/test";

/**
 * Smoke spec for /watch, the public page a WhatsApp lead sees before
 * onboarding. Public is the point: no login wall may ever appear here.
 */
test.describe("/watch", () => {
  test("is public and shows the video first", async ({ page }) => {
    await page.goto("/watch");
    await expect(page).toHaveURL(/\/watch/);
    await expect(page.getByTestId("watch-video")).toBeVisible();
  });

  test("both buttons go to WhatsApp with the message pre-written", async ({ page }) => {
    await page.goto("/watch");
    for (const id of ["watch-cta-top", "watch-cta-bottom"]) {
      const href = await page.getByTestId(id).getAttribute("href");
      expect(href).toContain("wa.me/447460035763");
      expect(decodeURIComponent(href ?? "")).toContain(
        "I have watched the video and I'm happy to move forward.",
      );
    }
  });

  test("never scrolls sideways on a 360px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/watch");
    await page.getByTestId("watch-cta-bottom").scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
