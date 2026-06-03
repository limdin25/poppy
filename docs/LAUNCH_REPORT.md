# Elsie — launch readiness report

_Generated 2026-06-03. Production: https://heyelsie.com (landing) ·
https://app.heyelsie.com (app)._

## Recommendation: **GO** — with a 15-minute human sign-off pass

Everything structural is verified and live. The automated suite is green and the
launch-blocking regressions are fixed. Before you announce, run the short
**human checklist** at the bottom (the few flows that actually send WhatsApp
messages / hit third parties, which automation must not do against production).

---

## What was verified (automated, against live production)

Self-healing Playwright suite — **140 passed / 0 failed (chromium)**, **mobile
17/17**, 19 intentional skips (destructive/Kimi-only). One login, reused.

| Test | Page | Result | Notes |
|---|---|---|---|
| K-001 | Overview | ✅ | Stage badges (not Hot/Warm/Cold), Needs-your-reply rows + avatars, Next-6h, stat cards numeric, nav links. |
| K-002 | Inbox | ✅ | Folder tabs, no "+Deal" header, footer has AI/Status/Follow-up/💰deal-value/Notes, inline draft edit, **no flicker**, chronological order. |
| K-003 | Leads · Pipeline | ✅ | Stage columns, deal cards w/ currency value, column totals, add-deal modal, rename, note indicators. |
| K-004 | Leads · Table | ✅ | Count badge, status dropdown, AI toggle, chat link, delete-confirm, add-lead modal, export/import controls, bulk select. |
| K-005 | Appointments | ✅ | Stat cards, Today/Upcoming/Past tabs, new-booking form, Connect-Calendar present, no overflow. |
| K-006 | Campaigns | ✅ | Stat cards, creation flow (name/audience/message), WhatsApp-scoped. |
| K-007 | Knowledge | ✅ | 4 source tiles, add-website/paste modals, sync status, Set-up-Elsie modal, Test box. |
| K-008 | Templates | ✅ | Quick-replies + Follow-ups tabs, new-template modal, edit/delete controls. |
| K-009 | AI Agent | ✅ | Personality fields, **Goals** (renamed everywhere), presets + custom goal, follow-up + handoff controls. |
| K-010 | Integrations + Analytics | ✅ | WhatsApp connected, gated channels, calendar; analytics time-range + channel filter switch, funnel uses stage names. |
| K-011 A/B | Settings + currency | ✅ | Currency selector (GBP/USD/EUR), profile/company fields. (Live currency propagation = human check.) |
| K-012 | Global + mobile | ✅ | All nav links reach pages, mobile bottom nav, sign-out (desktop + mobile drawer), no raw errors, no flicker. |

## Bugs fixed this session

**Critical (were launch-blockers):**
- **Inbox flicker + scrambled order** — broken poll dedup re-inserted each message
  every cron cycle (88 copies each). Fixed dedup + purged 9,038 dupes. Regression
  test guards it.
- **Home routing** — `heyelsie.com/` was the dashboard; now it's the landing, app
  on `app.heyelsie.com`. Verified live.
- **Production build was broken** by unfinished WIP — finished + committed; `tsc -b`
  green.

**Features added (were missing):** currency setting + propagation, inbox 💰
deal-value, Notes (inbox→pipeline→table), Overview wiring (stage labels, Next-6h,
avatars), Classification→**Goals** rename.

**Found by the new suite + fixed:** the global sidebar still said "Classification"
while everything else said "Goals" → renamed.

## Built for ongoing safety

- `tests/e2e/` self-healing Playwright suite (intent-based locators; warns which
  `data-testid` to add when it heals).
- `tests/kimi/` human-QA scripts K-001..K-012.
- `.github/workflows/tdd-gate.yml` — typecheck + unit + build on every push/PR.
- `docs/tdd-log.md`, `docs/QA_ACCOUNTS.md`.

---

## Human sign-off checklist (do once before announcing) — ~15 min

These send real messages / hit third parties, so they're deliberately **not**
automated against production. Run them via Kimi (`tests/kimi/README.md`):

1. **K-011.12 Follow-up delivery (most important):** schedule a follow-up ~2 min
   out, don't reply, confirm the WhatsApp message arrives. _(Cron delivery was
   observed working earlier this session — confirm once more on a fresh thread.)_
2. **K-011.13:** reply before the trigger → follow-up is skipped.
3. **K-006.4:** schedule a tiny campaign to 1 test number → it sends.
4. **K-007.1/.7:** add a website to the KB → Synced → ask the inbox a KB question.
5. **K-005.6 / K-010.3:** Connect Google Calendar OAuth completes.
6. **K-011.6-9:** profile photo upload shows in sidebar; team "+ Invite" sends.
7. **K-011.2-5:** switch currency GBP→USD, confirm £→$ everywhere, switch back.

## Top 3 to confirm before going fully live

1. **Follow-up actually delivers** to a real WhatsApp number (K-011.12).
2. **Currency propagation** flips every deal display (K-011.2-5).
3. **KB answers a live question** in the inbox (K-007.7).

If those three pass by hand, you're clear to announce on heyelsie.com.
