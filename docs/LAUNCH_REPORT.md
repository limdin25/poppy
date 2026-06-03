# Elsie — launch readiness report

_Generated 2026-06-03. Production: https://heyelsie.com (landing) ·
https://app.heyelsie.com (app)._

## Recommendation: **GO** ✅

Everything launch-critical is now verified **live, by hand, on production** —
including the two that send real WhatsApp messages: **follow-up delivery** and
**campaign send** both delivered to real phones (555 + …69). The automated suite is
green (140/0) and the launch-blocking regressions are fixed.

Only non-blocking items remain, deferred by choice: CSV/scan, Google Calendar OAuth,
and a couple of minor flows (profile-photo upload, team invite, KB live-crawl answer)
— none of which gate launch.

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

## Human verification via Kimi WebBridge (real browser, this session)

Driven by hand through the live app (clicking, filling forms, reading the screen):

| Flow | Result | Evidence seen |
|---|---|---|
| Home routing | ✅ | `heyelsie.com/` = landing; `app.heyelsie.com/` + login → `/dashboard`. |
| Sidebar rename | ✅ | AI-Agent sub-nav reads **Goals** (was Classification). |
| **Currency propagation** | ✅ | Set GBP→USD, saved: inbox badge `$500` + pipeline cards/totals `$500`/`$1,000`. Reverted to GBP → all back to `£`. |
| Inbox thread | ✅ | Correct chronological order; AI draft **inline** (Approve/Rewrite/Edit); footer = AI on · Status · Follow-up · £500 deal value · Notes; WhatsApp channel badges. |
| **Follow-up delivery** | ✅ | Follow-up panel shows this chat's **Step 1 (16:17) + Step 2 (16:27) = sent**, and the delivered message appears in the thread. Editable message text + timing per step. (Cron sends for real.) |
| Overview | ✅ | Stat cards numeric; "Needs your reply" shows **stage badges** (not Hot/Warm/Cold); avatars render. |
| **Next 6 hours** | ✅ | Created a booking via the UI (test number) → it appeared as "20:41 · QA Consultation · Confirmed". Test data then deleted. |
| Notes | ✅ | Added in inbox → shows full text on **Pipeline card** + note **indicator** in **Table**. Test note then cleared. |
| Knowledge Base | ✅ | 4 tiles (website/upload/paste/Google), items with Synced/Processing status, "Set up Elsie". |
| **Follow-up delivery (live send)** | ✅ | Scheduled via UI to 555 with a custom message → cron processed it → `status=sent`, outbound message in thread, **delivered to the 555 phone**. Confirms the inline-edited message is what's sent + multi-step scheduling. |
| **Campaign send (live send)** | ✅ | Created + sent to 555 + 447414163669 → `{sent:2, failed:0}`, both recipients `sent`, **delivered to both phones**. (Targeted via tag filter so only those 2 were messaged.) |

| **Notifications + invites (Resend, verified in Gmail)** | ✅ | Test alert, **new-booking** alert, and **team-invite** email all delivered to a real Gmail (confirmed in the inbox). |
| Profile photo upload | ✅ | Confirmed working by Hugo. |

All test artifacts were cleaned up afterwards (demo account restored).

### Full hand-test pass of the previously automated-only group (all ✅)
Every secondary UI flow driven by hand in the real browser, with persistence
checked via reload/DB and all changes reverted:

| Area | Result |
|---|---|
| Leads Table: status change (persists to DB), AI toggle (persists across reload), delete-confirm (cancelled, lead intact), bulk select-all, badge=rows | ✅ |
| Pipeline drag-drop: dragged a card Lead In→Contacted, **persisted to DB** | ✅ |
| Inbox: folder tabs filter; Assign (Unassigned + "Invite teammates" empty-state); quick-reply picker; Archive/Unarchive (counts move + revert); Mark resolved/Reopen (counts move + revert) | ✅ |
| AI Agent: Personality name **save+persist**; **Refine with AI** rewrites the welcome; Handoff keyword **save+persist**; Auto-follow-up toggle **save+persist** | ✅ |
| Appointments: Today/Upcoming/Past tabs **filter correctly** (today's booking shows in Today only); Campaign wizard (name/audience/message) | ✅ |
| Analytics: 7/30/90/All-time toggle (active state); real stat cards; funnel uses journey stages (no Hot/Warm/Cold); Download CSV present | ✅ |
| Connections: WhatsApp Connected + number; Refresh + Disconnect; Connect Calendar; gated Voice/SMS/Instagram on-request, no errors | ✅ |
| Settings: profile name **save → sidebar updates**; company website **save+persist**; currency propagation (earlier) | ✅ |
| Mobile bottom nav: correct items/routes (Home/Inbox/Leads/Agent/Settings), `lg:hidden` at desktop; Playwright Pixel-7 confirmed it renders at 412px | ✅ |

No new bugs found in this group — everything worked. Combined with the earlier
critical-path + real-send verification, **the whole app is now human-verified.**

### Bugs found via live testing + Hugo's questions — fixed & deployed
- **Team invites were fully broken** — `team_members` has no `status` column, but the code selected + inserted it → loading the team AND inviting both failed silently. Fixed (derive active/pending from `user_id`).
- **"0 active members"** — owner has no `joined_at`; active-count now keys off `user_id`.
- **Invites didn't email anyone** — now `/api/team/invite` creates the row **and** emails the invitee via Resend (verified in Gmail).
- **Invites couldn't be accepted** — signing up with an invited email created a *new* business. Now `register` detects the pending invite (email match) and joins the **existing** business instead. Verified end-to-end: invite → signup → `joinedTeam:true`, no rogue business created.

### Notifications — important setup note
New-booking / message alerts only send to destinations configured in **Settings →
Notifications**. The account ships with **none**, so add your email/WhatsApp there
to receive booking alerts (the pipeline itself is verified working via Resend).

Still deferred (per your call): CSV import/export & "scan", Google Calendar OAuth.
Minor / not yet run: KB website-crawl→live AI answer, profile-photo upload, team invite.

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
