# QA / test accounts

| Purpose | Email | Password | Notes |
|---|---|---|---|
| **Demo** (default for e2e + Kimi) | `demo.user@heyelsie.com` | `demo1234` | Seeded with real conversations / leads / deals — use this for data-dependent assertions (Pipeline totals, Needs-your-reply, etc.). Also `demo.admin@…` (voice) and `demo.super@…` (/super) share the same password. |
| **Isolated QA owner** | `test-owner@heyelsie-qa.com` | `QaOwner!Els1e2026` | Created via `POST /api/auth/register`. Has its own business **QA Test Co** (GBP) + owner membership. **Empty** — no conversations/leads yet, so data-dependent specs will hit empty states until it's seeded. |

## Which the test suites use

- **Playwright e2e** defaults to the **demo** account (data-rich → meaningful
  assertions). Point it at the isolated QA owner with:
  ```bash
  E2E_EMAIL=test-owner@heyelsie-qa.com E2E_PASSWORD='QaOwner!Els1e2026' \
    E2E_BASE_URL=https://app.heyelsie.com npx playwright test
  ```
- **Kimi human-QA** uses the demo account (see `tests/kimi/README.md`).

## Reconciliation (Hugo's flag)

Both suites currently default to **demo** because the isolated QA owner isn't
seeded. To make the QA owner the canonical isolated identity, seed it with a
handful of contacts/conversations/deals/appointments (so panels render) and then
flip the suites to it via the env vars above. Until then, demo is the right target.

## Provisioning details (QA owner)

- userId: `6af37ad9-996e-4fac-bf53-f8e26a76cb78`
- businessId: `bd91d65c-d140-4464-abde-710d960aabfe`
- Created 2026-06-03 through the production register endpoint (real provisioning
  path: auth user + `businesses` row + `team_members` owner row).
