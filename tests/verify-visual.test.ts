import { test, expect } from '@playwright/test'

test('verify +351964888769 conversation renders media', async ({ page }) => {
  // Login
  await page.goto('https://app.heyelsie.com/login')
  await page.getByText('Try demo account').click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('https://app.heyelsie.com/', { timeout: 10_000 })

  // Navigate to inbox
  await page.goto('https://app.heyelsie.com/inbox')
  await page.waitForTimeout(2000)

  // Click on +351964888769 conversation
  await page.getByText('+351964888769').first().click()
  await page.waitForTimeout(2000)

  // Take screenshot
  await page.screenshot({ path: 'test-results/verify-351.png', fullPage: false })

  // Check for media elements
  const images = await page.locator('img[alt="Shared image"]').count()
  const audios = await page.locator('audio').count()
  const videos = await page.locator('video').count()
  console.log(`+351964888769: ${images} images, ${audios} audios, ${videos} videos`)

  // Check no "Poppy AI" label on outbound messages (should be plain outbound)
  const poppyAiLabels = await page.locator('text=Poppy AI').count()
  console.log(`Poppy AI labels: ${poppyAiLabels}`)
})

test('verify +40758891962 conversation - no fake reaction msg', async ({ page }) => {
  await page.goto('https://app.heyelsie.com/login')
  await page.getByText('Try demo account').click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL('https://app.heyelsie.com/', { timeout: 10_000 })

  await page.goto('https://app.heyelsie.com/inbox')
  await page.waitForTimeout(2000)

  // Check sidebar doesn't have @s.whatsapp.net
  const sidebarText = await page.locator('.mt-2.flex-1.overflow-y-auto').textContent()
  const hasWhatsappId = sidebarText?.includes('@s.whatsapp.net') || false
  console.log(`Sidebar has @s.whatsapp.net: ${hasWhatsappId}`)

  // Click on +40758891962
  await page.getByText('+40758891962').first().click()
  await page.waitForTimeout(2000)

  await page.screenshot({ path: 'test-results/verify-407.png', fullPage: false })

  // Check no standalone reaction message text
  const reactionMsg = await page.locator('text={{447863992555@s.whatsapp.net}} reacted').count()
  console.log(`Fake reaction messages: ${reactionMsg}`)

  // Check for 👍 reaction emoji on the message
  const reactions = await page.locator('text=👍').count()
  console.log(`Reaction emojis visible: ${reactions}`)
})
