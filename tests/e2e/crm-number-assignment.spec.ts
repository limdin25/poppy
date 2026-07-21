import { test, expect } from './helpers/auth'

/**
 * Settings → Numbers → "Assign numbers to agents": admin can assign an agent to
 * a number (many-to-many) and remove them. Runs against prod with a CRM admin
 * (E2E_OWNER_READY=1). Full assign→verify→unassign round-trip, leaves no residue.
 */
test.describe('CRM — number ↔ agent assignment', () => {
  test.skip(process.env.E2E_OWNER_READY !== '1', 'needs a CRM admin account (E2E_OWNER_READY=1)')

  test('assign an agent to a UK number, then remove them', async ({ authedPage: page }) => {
    await page.goto('/admin/crm/settings?scope=workspace-only&section=numbers')

    // Scope to the assignment card (the number also appears in the toggle card above).
    const card = page.locator('div.rounded-2xl').filter({ hasText: 'Assign numbers to agents' })
    await expect(card).toBeVisible({ timeout: 20000 })

    // The enabled UK SMS line shows in the card with its SMS badge.
    const row = card.locator('div.rounded-xl').filter({ hasText: '+447576558278' })
    await expect(row).toBeVisible()
    await expect(row.getByText('SMS', { exact: true })).toBeVisible()

    // Assign the first real agent from the "+ Assign agent" dropdown.
    const select = row.locator('select')
    const optionLabels = await select.locator('option').allTextContents()
    const agent = optionLabels.find((o) => o && !/Assign agent/i.test(o))
    expect(agent, 'at least one agent should be assignable').toBeTruthy()
    await select.selectOption({ label: agent! })

    // The agent chip (a pill) appears after the DB round-trip. Scope to the
    // pill so we don't match the agent's name when it returns as a <select> option.
    const chip = row.locator('span.rounded-full').filter({ hasText: agent! })
    await expect(chip).toHaveCount(1, { timeout: 15000 })

    // Remove them again (cleanup) — the pill's ✕ button (last button in the pill).
    await chip.locator('button').last().click()
    await expect(chip).toHaveCount(0, { timeout: 15000 })
  })
})
