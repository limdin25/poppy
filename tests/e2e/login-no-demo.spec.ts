import { test, expect } from '@playwright/test'

/** The public login page must not expose the one-tap demo logins. */
test('login page shows no demo logins', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible()
  await expect(page.getByText(/demo logins/i)).toHaveCount(0)
  await expect(page.getByText('WhatsApp user')).toHaveCount(0)
  await expect(page.getByText('/super panel')).toHaveCount(0)
})
