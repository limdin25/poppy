# Elsie e2e suite (Playwright, self-healing)

Automated end-to-end tests for the things safe to run against a live deployment.
The destructive / human-eye checks live in the [Kimi scripts](../kimi/README.md).

## Run

```bash
# Against a deployed URL (no local server needed):
E2E_BASE_URL=https://app.heyelsie.com npx playwright test --project=chromium

# Against the preview, mobile + desktop:
E2E_BASE_URL=https://elsie-preview.vercel.app npx playwright test

# Local dev server (auto-started on :5174):
npx playwright test

# One area:
E2E_BASE_URL=https://app.heyelsie.com npx playwright test inbox.spec.ts

# Open the HTML report after a run:
npx playwright show-report
```

## How it stays un-brittle: the self-healing locator

`helpers/healer.ts` resolves elements by **intent**, trying strategies in order:

1. `data-testid` (preferred / most stable)
2. ARIA role + accessible name
3. label / placeholder
4. visible text
5. raw CSS (last resort)

It returns the first strategy that resolves to a visible element and **logs a
warning naming the testid to add** whenever it has to fall back. So a renamed class
or a moved testid doesn't turn the suite red — it heals and tells you how to harden
it. See `HEAL_LOG` / `healSummary()`.

```ts
import { test, expect } from './helpers/auth'
import { heal, existsHealed } from './helpers/healer'

test('example', async ({ authedPage }) => {
  await authedPage.goto('/leads')
  expect(await existsHealed(authedPage, { testid: 'add-lead-btn', role: { type: 'button', name: /add lead/i } })).toBeTruthy()
})
```

`authedPage` (from `helpers/auth.ts`) is a Page already logged in on `/dashboard`.

## Test account

Defaults to the seeded demo account (`demo.user@heyelsie.com` / `demo1234`) because
its data makes the assertion-rich pages (Pipeline totals, Needs-your-reply, Next-6h)
meaningful. Override for an isolated identity:

```bash
E2E_EMAIL=test-owner@heyelsie-qa.com E2E_PASSWORD=… npx playwright test
```

A `test-owner@heyelsie-qa.com` QA user is provisioned (see
[`docs/QA_ACCOUNTS.md`](../../docs/QA_ACCOUNTS.md)); seed it before pointing the
data-dependent specs at it, otherwise empty-state pages will fail those assertions.

## Safety

These specs are written **non-destructively** against production: they assert
controls exist and open modals/panels, but never send WhatsApp messages, schedule
campaigns, delete records, or complete OAuth. Anything that must mutate the real
world is marked `test.skip(... [Kimi-only])` and covered by the Kimi scripts.
