# Agent isolation, lead locking, and phone verification

Shipped 2026-07-28. Answers three things Hugo asked to have confirmed or fixed
after Maria's first SMS test overlapped work Pedro and Marr had already done.

---

## 1. Different agents send from different numbers

Each CRM agent has their own dedicated Twilio number, so a lead always sees a
different sender depending on who is texting them:

| Agent | Number |
|---|---|
| Pedro | +447462167894 |
| Marr | +447462192202 |
| Maria | +447460035763 |

Verified live 2026-07-28 against `wk_number_agents`/`wk_sms_messages` — all 50
of Maria's test texts really did send `from_e164 = +447460035763`.

---

## 2. Agent isolation — a test agent's texts are invisible to everyone else

**Problem found 2026-07-27:** `wk_sms_messages` RLS let any agent read every
message in the workspace (fixed same day — see migration
`20260727000020_sms_messages_participation_rls.sql`). That fix still let an
agent see another agent's text **on a lead they had personally called** (the
"participation" model — intentional, so two agents don't blind-double-work a
lead). Hugo accepted that carve-out once, then reversed it for Maria on
2026-07-28: he wants her texts invisible to Pedro/Marr full stop, even on a
lead they're actively calling.

**Fix — migration `20260728000001_agent_isolation_and_lead_lock.sql`:**

- New column `profiles.is_isolated_agent` (boolean, default false). Maria is
  the first agent flagged `true`. Not hardcoded to her — any future test
  agent just needs the same flag set.
- New helper `wk_is_isolated_sender(agent_id)` (SECURITY DEFINER).
- `wk_sms_messages_read` policy is now:

  ```sql
  wk_is_admin()
  or created_by = auth.uid()
  or (wk_agent_participates(contact_id) and not wk_is_isolated_sender(created_by))
  ```

  The participation carve-out simply does not apply when the message's
  sender is flagged isolated.

**Verified live:** logged in as Pedro for real (not the admin "see-as" view,
which proves nothing) — before the fix he could read 7 of Maria's messages,
after the fix he reads 0.

---

## 3. One lead, one agent — enforced at send time

Hugo also asked that Maria (and everyone) never contact a lead another agent
has already contacted, and vice versa.

**New function** `wk_contact_locked_agent(contact_id)` (SECURITY DEFINER)
returns whichever real agent (`profiles.workspace_role = 'agent'` on both
sides of the check — admin never sets or breaks a lock) first texted or
called that contact, across `wk_sms_messages` and `wk_calls` combined.

**Enforced in two places, both edge functions, before anything reaches
Twilio:**

- `supabase/functions/wk-sms-send/index.ts` — rejects with `409` and
  `"This lead has already been contacted by another agent — send blocked."`
- `supabase/functions/wk-calls-create/index.ts` — returns
  `{ allowed: false, reason: 'already contacted by another agent' }`, the
  same shape the spend-limit gate already used, so the existing frontend
  toast handling needed no changes.

Admin sends are exempt in both directions: an admin can always follow up on
any lead, and an admin's own sends never lock a lead against the agents.

**Verified live:**
- Re-running the lock function over Maria's real 50-lead test batch shows
  all 50 were already locked — 43 to Marr, 7 to Pedro. This is exactly the
  overlap Hugo flagged; the rule would have caught it.
- A live test send as Maria against one of those contacts was blocked with
  the 409 above, before any Twilio call fired (no real SMS sent).

---

## 4. Phone verification — closed a gap between the tool and the pipeline

`/admin/phone-validation` (built 2026-07-16) is a real, working, self-hosted
mobile-number validator (`api/lib/phone-validation.ts`, libphonenumber-js +
a NANPA table for US numbers). It was a **manual side-door** — Hugo had to
separately upload a CSV there before sending. The scripts that actually load
a CSV into a campaign (`process-plumber-leads.mjs`, `assign-agent-batches.mjs`,
`scrape-trade-leads.mjs`, etc.) never called it, so a scraped number could
reach a campaign, and a lead, without ever being checked.

**Fix:** new shared helper `scripts/lib/verify-phone.mjs`
(`isTextableUkMobile`), same libphonenumber-js check the validator page uses
(GB parse → `isValidPhoneNumber` → `getNumberType` must be `MOBILE` or
`FIXED_LINE_OR_MOBILE`). Wired into every lead-import/scrape script that puts
a number in front of an agent:

- `process-plumber-leads.mjs`
- `assign-agent-batches.mjs`
- `import-plumber-leads.mjs` (legacy, `FORCE_LEGACY=1` gated)
- `scrape-trade-leads.mjs` — previously had its own hand-rolled regex
  (`/^0?7\d{9}$/`), now uses the shared helper
- `assign-trade-leads-to-pedro-marr.mjs` — same swap

Not touched: any manual single "Add contact" UI in the CRM/reviews features
— that's a business owner adding a known customer, a different risk profile
from cold-scraped numbers.

---

## 5. Maria's current lead pool

`scripts/feed-maria-leads.mjs` (2026-07-28) — a dedicated pipeline, not the
shared "Plumbers - test" pool other agents were pulling from (that shared
pool is *why* yesterday's overlap happened in the first place). Filters:

1. Named-owner only.
2. **Genuinely unused** — phone must not exist anywhere in `wk_contacts` yet
   (preloads every existing phone and excludes it, rather than upserting).
3. Real UK mobile (`verify-phone.mjs`).
4. No website.
5. 0–25 reviews, Google-enriched (a CSV "0" often just means the scraper
   couldn't read the real count).

First run, 2026-07-28: **100 contacts** loaded, owned by Maria, queued to a
new dedicated **"Plumbers - Maria"** campaign on her own number
(+447460035763), ordered A→Z. Queues only — nothing texted. Copy is pending
from Hugo.

---

## 6. AI auto-reply mode

`wk_ai_reply_settings` is a **single global row shared by every agent** —
there is no per-agent AI configuration in this system. Checked live
2026-07-28: `mode = 'draft'`, `enabled = true`. Draft mode means every AI
reply is queued for a human to approve before it sends — it never auto-sends
to anyone, Maria included, until someone flips it to `'auto'` in the
settings drawer.

**Caveat worth knowing:** because it's global, this is not a Maria-specific
switch. If `'auto'` is ever turned on for anyone, it is on for every agent's
leads at once, Maria's included, and vice versa. There is currently no way
to give one agent auto-replies while keeping another on draft.

---

## Guard tests

- `tests/sms-message-scoping.test.ts` — the original SMS RLS fix, plus a
  check that no later migration reopens the blanket `wk_is_agent_or_admin()`
  check.
- `tests/agent-isolation-and-lead-lock.test.ts` — the isolation flag, the
  updated policy, and the lock function shipped today.
