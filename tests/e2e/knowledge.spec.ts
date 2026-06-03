import { test, expect } from './helpers/auth'
import { heal, existsHealed } from './helpers/healer'

// Knowledge Base — /knowledge
// Step 1: four option tiles. Step 2: "Set up Elsie" (checklist modal). Step 3: Test box.
// SAFE-ONLY: open modals then Cancel/Escape. Never submit a KB item, never run apply,
// never crawl/upload/delete. Test/Send box: assert presence only, never submit.

test.describe('Knowledge Base', () => {
  test('page heading renders', async ({ authedPage }) => {
    await authedPage.goto('/knowledge')
    await expect(
      await heal(authedPage, { role: { type: 'heading', name: 'Knowledge Base' }, describe: 'page heading' }),
    ).toBeVisible()
  })

  // K-007 (a) — the four "how to add knowledge" option tiles
  test('option tile: Add a website exists', async ({ authedPage }) => {
    await authedPage.goto('/knowledge')
    expect(await existsHealed(authedPage, { text: 'Add a website', describe: 'Add a website tile' })).toBe(true)
  })

  test('option tile: Upload a file exists', async ({ authedPage }) => {
    await authedPage.goto('/knowledge')
    expect(await existsHealed(authedPage, { text: 'Upload a file', describe: 'Upload a file tile' })).toBe(true)
  })

  test('option tile: Paste notes exists', async ({ authedPage }) => {
    await authedPage.goto('/knowledge')
    expect(await existsHealed(authedPage, { text: 'Paste notes', describe: 'Paste notes tile' })).toBe(true)
  })

  test('option tile: Find on Google exists', async ({ authedPage }) => {
    await authedPage.goto('/knowledge')
    expect(await existsHealed(authedPage, { text: 'Find on Google', describe: 'Find on Google tile' })).toBe(true)
  })

  // K-007 (b) — clicking "Add a website" opens an input modal; close with Cancel/Escape (no submit)
  test('"Add a website" opens the input modal then closes', async ({ authedPage }) => {
    await authedPage.goto('/knowledge')
    const tile = await heal(authedPage, { text: 'Add a website', describe: 'Add a website tile' })
    await tile.click()
    const modalHeading = await heal(authedPage, {
      role: { type: 'heading', name: 'Add to knowledge base' },
      describe: 'add-source modal heading',
    })
    await expect(modalHeading).toBeVisible()
    // Website tab shows the URL field — assert presence, do NOT fill/submit.
    expect(
      await existsHealed(authedPage, { placeholder: 'https://yourbusiness.co.uk', describe: 'website URL input' }),
    ).toBe(true)
    await authedPage.keyboard.press('Escape')
  })

  // K-007 (b) — "Paste notes" opens the same modal on the notes tab; close (no submit)
  test('"Paste notes" opens the input modal then closes', async ({ authedPage }) => {
    await authedPage.goto('/knowledge')
    const tile = await heal(authedPage, { text: 'Paste notes', describe: 'Paste notes tile' })
    await tile.click()
    const modalHeading = await heal(authedPage, {
      role: { type: 'heading', name: 'Add to knowledge base' },
      describe: 'add-source modal heading',
    })
    await expect(modalHeading).toBeVisible()
    expect(
      await existsHealed(authedPage, { text: 'Notes', describe: 'notes label' }),
    ).toBe(true)
    await authedPage.keyboard.press('Escape')
  })

  // K-007 (c) — existing KB items (if any) show a sync status pill (Synced/Processing/Failed)
  test('existing KB items show a sync status (if any exist)', async ({ authedPage }) => {
    await authedPage.goto('/knowledge')
    // Wait for the list/empty-state to settle.
    const emptyState = await existsHealed(authedPage, { text: 'No knowledge yet', describe: 'empty state' })
    if (emptyState) {
      // No items on the shared demo account — nothing to assert against.
      expect(emptyState).toBe(true)
      return
    }
    const hasStatus =
      (await existsHealed(authedPage, { text: 'Synced', describe: 'Synced pill' })) ||
      (await existsHealed(authedPage, { text: 'Processing', describe: 'Processing pill' })) ||
      (await existsHealed(authedPage, { text: 'Failed', describe: 'Failed pill' }))
    expect(hasStatus).toBe(true)
  })

  // K-007 (d) — "Set up Elsie" button exists
  test('"Set up Elsie" button exists', async ({ authedPage }) => {
    await authedPage.goto('/knowledge')
    expect(
      await existsHealed(authedPage, { role: { type: 'button', name: 'Set up Elsie' }, describe: 'Set up Elsie button' }),
    ).toBe(true)
  })

  // K-007 (d) — opening the checklist modal then Cancel (do NOT run apply).
  // The button is disabled until there is synced knowledge; only exercise the modal if enabled.
  test('"Set up Elsie" opens its checklist modal then cancels (if enabled)', async ({ authedPage }) => {
    await authedPage.goto('/knowledge')
    const btn = await heal(authedPage, { role: { type: 'button', name: 'Set up Elsie' }, describe: 'Set up Elsie button' })
    await expect(btn).toBeVisible()
    if (await btn.isDisabled()) {
      // No synced knowledge on the demo account → button gated. Presence already covered above.
      return
    }
    await btn.click()
    const modalHeading = await heal(authedPage, {
      role: { type: 'heading', name: 'What should Elsie set up?' },
      describe: 'setup checklist modal heading',
    })
    await expect(modalHeading).toBeVisible()
    // Cancel — never click the in-modal "Set up Elsie" (that runs apply).
    const cancel = await heal(authedPage, { role: { type: 'button', name: 'Cancel' }, describe: 'Cancel button' })
    await cancel.click()
    await expect(modalHeading).toBeHidden()
  })

  // K-007 (e) — a Test/Send box exists (assert presence; do NOT submit)
  test('Test Elsie box exists with input and Send button', async ({ authedPage }) => {
    await authedPage.goto('/knowledge')
    expect(
      await existsHealed(authedPage, { role: { type: 'heading', name: '3 · Test Elsie' }, describe: 'Test Elsie heading' }),
    ).toBe(true)
    expect(
      await existsHealed(authedPage, {
        placeholder: 'e.g. "Do you cover Richmond, and how much?"',
        describe: 'test question input',
      }),
    ).toBe(true)
    expect(
      await existsHealed(authedPage, { role: { type: 'button', name: 'Send' }, describe: 'Send button' }),
    ).toBe(true)
  })
})
