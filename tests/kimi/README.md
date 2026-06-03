# Elsie — Kimi human-QA scripts (K-001 → K-012)

These are **human-driven** QA scripts for the [Kimi WebBridge](../../../.claude/skills/kimi-webbridge/SKILL.md)
browser (Hugo's real logged-in session). They cover the things an automated
Playwright run should NOT do against production — sending real WhatsApp messages,
scheduling live campaigns, completing OAuth, deleting records, and the
**end-to-end follow-up delivery** that's the single most important launch check.

The automated counterpart lives in [`tests/e2e/`](../e2e/) (run with `npx playwright test`).
Anything safe to automate is there; anything that mutates the real world or needs a
human eye is here.

## How to run

1. Confirm the bridge is up: `~/.kimi-webbridge/bin/kimi-webbridge status`
2. Target: **https://app.heyelsie.com** (production app) or
   **https://elsie-preview.vercel.app** (preview).
3. Work through K-001 → K-012 in order. Each step is PASS / FAIL with one line of
   reasoning.
4. Compile the [final report](#final-report-format) at the end.

## Test account

| Suite | Account | Why |
|---|---|---|
| Kimi (these scripts) | `demo.user@heyelsie.com` / `demo1234` | Seeded with real conversations/deals so panels aren't empty. |
| Playwright e2e | same demo account by default; override with `E2E_EMAIL` / `E2E_PASSWORD` | A dedicated `test-owner@heyelsie-qa.com` identity exists for isolated runs (see [tests/e2e/README](../e2e/README.md)). |

> **Reconciliation note (Hugo flagged this):** the Playwright suite and Kimi both
> default to the **demo** account today because it carries seeded data. The
> `test-owner@heyelsie-qa.com` QA identity is provisioned for future isolated runs
> once it's seeded; until then, keep both suites on the demo account so panels
> (Needs-your-reply, Pipeline totals, Next-6-hours) actually have data to assert.

---

## K-001: Overview / Dashboard — `/dashboard`

1. Do the "Needs your reply" status badges show **pipeline stage** labels (Lead In,
   Contacted, Meeting Scheduled, Proposal Sent, Negotiation, Closed Won, Closed
   Lost) and **NOT** old Hot/Warm/Cold? If any say Hot/Warm/Cold → BUG.
2. Does "Next 6 hours" show scheduled **appointments AND follow-ups** (or a clean
   "nothing booked" only when truly empty)? Cross-check against /appointments.
3. Do lead avatars show real photos / initials (not broken image icons)?
4. Do the 4 stat cards show real numbers (no `NaN`, no perpetual spinner)?
5. Does "Where conversations come from" show an accurate WhatsApp count?
6. Does "Conversations handled" render, and does the 7-day / 30-day toggle change it?
7. Does the "Live" dot reflect real activity, and does "Open inbox →" go to /inbox?
8. Do "All →" (→ /appointments) and KB "Manage →" (→ /knowledge) links work?

## K-002: Inbox — `/inbox`

1. Filter tabs (Inbox, Unread, Assigned to me, Assigned to team, Archived, Closed)
   each filter correctly.
2. A draft only appears when an inbound message awaits a reply; after
   **Approve & send**, the draft card disappears immediately and the sent message
   appears in the thread.
3. The conversation header has **no "+ Deal"** button.
4. Footer toolbar has: AI on/off, Status (deal stage) dropdown, Follow-up, a
   **💰 deal-value** field, and a **Notes** button.
5. Set a deal value (e.g. 500) → the conversation list shows `Stage · £500`.
6. Add a Note → it persists and appears on the Pipeline card and Table row (K-003/4).
7. **Edit** on a draft turns it into an inline editable box (Save/Cancel) — not the
   composer.
8. Assign opens a teammate dropdown; quick-reply (lightning) opens templates.
9. Watch the open thread ~10s: it must be **completely still** (no flicker).
10. Messages are in correct chronological order.

## K-003: Leads — Pipeline view — `/leads`

4. Deal cards show deal name, phone, and a deal value (£/configured symbol).
5. Each column footer shows count AND total (e.g. "3 deals · £1,000").
6. Drag a card Lead In → Contacted: it moves and stays.
7. Table view shows that lead now "Contacted" (drag persisted to DB).
8. Click a deal card → opens the lead's conversation/detail.
9. Click a column title → rename saves.
10. "+ Add deal" creates a card in that stage.
11. A note added in the Inbox (K-002.6) appears on the deal card. If not → BUG.

## K-004: Leads — Table view — `/leads`

1. Lead count badge matches visible rows.
2. Row Status dropdown updates instantly.
3. Row AI toggle off → refresh → stayed off.
4. Chat icon → opens lead in /inbox.
5. Delete icon → confirmation dialog (not instant).
6. Cancel delete → lead still there.
7. "+ Add Lead" → modal asks phone + status.
8. Add a lead → appears + count increments.
9. Export → CSV downloads.
10. Import CSV → small test CSV adds leads.
11. Checkboxes → bulk select works.

## K-005: Appointments — `/appointments`

1. 3 stat cards (Today, This Week, Confirmed Rate) show real numbers.
2. Today / Upcoming / Past tabs change the list.
3. "+ New booking" opens a form.
4. Create a booking within the next 6h → saves + appears.
5. Overview "Next 6 hours" now shows that booking (else wiring BUG).
6. "Connect Google Calendar" launches OAuth (don't complete).
7. Layout clean, nothing overflowing.

## K-006: Campaigns — `/campaigns`

1. Stat cards (Active, Messages Sent, Recipients Reached) show real numbers.
2. "+ New campaign" opens a creation flow.
3. Flow lets you set name, channel (WhatsApp), recipients (from leads), template,
   schedule.
4. Save/schedule → appears in list with name, channel, recipient count, status.
5. Recipient selection picks from existing leads.
6. Visible opt-out / unsubscribe / throttling handling (unsubscribed excluded).

## K-007: Knowledge Base — `/knowledge`

1. "Add a website" → URL → item appears Processing → Synced (≤30s).
2. Upload a small PDF/text → appears + indexed.
3. "Paste notes" → text saves as a KB item.
4. Existing items show accurate sync status.
5. Delete icon removes an item.
6. "Set up Elsie" → generates greeting/personality/services/FAQs into Agent
   settings (check /agents/personality after).
7. Live: ask the inbox something only answerable from the KB → draft uses it.

## K-008: Templates — `/templates`

1. "Quick replies" tab lists templates.
2. "Follow-ups" tab lists follow-up templates.
3. "+ New template" (name + body) → saves + appears.
4. In /inbox the lightning-bolt picker shows the new template.
5. Edit a template → change saves.
6. Delete a template → disappears.

## K-009: AI Agent — `/agents/*`

**A) Personality** `/agents/personality`
1. Fields present + editable: Assistant name, Welcome message, Tone, Services(+Add),
   Available days, Opens/Closes, Location, pre-appointment, cancellation.
2. Change name + welcome → Save → refresh → persisted.
3. "Refine with AI" rewrites the welcome message.

**B) Goals** `/agents/classification`
4. Page titled **"Goals"** in BOTH heading and left nav (not "Classification").
5. Description avoids "Hot / Warm / Cold".
6. Presets: Sales Pipeline, Book Intent, General Priority, Support.
7. "Custom goal" tile → add "Renewal Pipeline" → appears.
8. Toggle goal scoring on → Save → persists.

**C) Auto follow-up** `/agents/followup`
9. Enable/disable toggle persists after save.
10. Can set a follow-up delay.
11. Can select a follow-up template (live delivery tested in K-011).

**D) Handoff** `/agents/handoff`
12. Can set handoff conditions/keywords and save.

## K-010: Integrations & Analytics

**A) Connections** `/connections`
1. WhatsApp (Unipile) shows Connected + a number.
2. Refresh + Disconnect exist (don't disconnect).
3. "Connect Google Calendar" launches OAuth (don't complete).
4. Voice/SMS/Instagram show "available/on request" without erroring.
5. CSV lead import option exists.

**B) Analytics** `/analytics`
6. 7 / 30 / 90 / All toggle changes the data each time.
7. Stat cards (New Leads, Messages, AI Replies, AI Handled %, Median reply time,
   Bookings) show real numbers.
8. Conversion funnel uses pipeline stage names (Lead In, Contacted…), not
   Hot/Warm/Cold.
9. "Download CSV" exports the filtered data.

## K-011: Settings, Currency Propagation & Follow-up Delivery

**A) Currency** `/account/company`
1. Currency selector exists (GBP £ / USD $ / EUR €). If not → MISSING FEATURE.
2. Change to USD + save → refresh → persisted.
3. /inbox deal value now shows "$".
4. /leads Pipeline cards + totals show "$".
5. Switch back to GBP → everything reverts to "£" (one setting drives all).

**B) General & Org** `/account/general`, `/account/company`
6. Edit Full name + Save → sidebar name updates.
7. Upload profile photo → shows in sidebar.
8. Edit Business name + Website + Address + Save → persist.
9. "+ Invite" sends a team invite (enter a test email).

**C) Follow-up delivery (CRITICAL)** — live end-to-end
10. /inbox → Follow-up → schedule first message ~2 min out → Schedule.
11. Edit message text AND timing inline before scheduling → edit sticks (not the
    template default).
12. Wait 2–3 min **without replying** → the WhatsApp follow-up is delivered and
    appears in the thread. If not → **CRITICAL BUG** (cron not dispatching).
13. Repeat but reply from the lead side before the trigger → follow-up is **skipped**.

> Item 12 is the single most important test in the whole suite. Be thorough.

## K-012: Global / cross-cutting & mobile

1. Every sidebar nav link reaches the correct page.
2. Collapse/expand sidebar — state persists across navigation.
3. "Sign out" logs out → /login.
4. Mobile (~390px): bottom nav (Home, Inbox, Leads, Agent, Settings) appears + works.
5. Mobile: nothing cut off, overlapping, or unreadable.
6. Each page: empty state = helpful message (not blank); loading = spinner/skeleton;
   errors = friendly message (not a raw error object).
7. Inbox flicker spot-check (~10s): completely still. Flicker → CRITICAL BUG.
8. Thread messages in correct chronological order.

---

## Final report format

| Test ID | Page | Result | Critical failures | Notes |
|---|---|---|---|---|

Then, in priority order:
1. **CRITICAL** (block launch) — follow-up not sending, inbox flicker, build
   failing, broken auth.
2. **MISSING FEATURES** — currency selector, deal-value field, Notes.
3. **Cosmetic / visual** — overflow, placeholder avatars, wrong labels.
4. **Works but feels wrong** as a human user.

End with a single **GO / NO-GO** recommendation and the **top 3** things to fix
before going live on heyelsie.com.
