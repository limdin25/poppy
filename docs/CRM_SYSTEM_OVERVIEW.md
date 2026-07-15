# The CRM System — plain-English overview (audit copy)

Verified live 2026-07-15 · production: https://app.heyelsie.com/admin/crm
Wiring proof: `scripts/crm-wiring-check.mjs` (27 live checks) — last run 27/27 PASS.

---

## 1. The two apps and how they relate

- **heyelsie (the client app)** — what your *customers* use: their AI receptionist,
  their inboxes, their bookings. Untouched by everything below.
- **The CRM (`/admin/crm`)** — your *internal* sales machine: a full clone of the
  hub.nfstay.com call-centre, rebuilt on Elsie's own stack, plus the new growth
  engine. Sales agents log in here and see ONLY the CRM; the rest of your admin
  panel stays yours. The old NFStay system was never touched and still runs.

They share the same database *server* but write to completely separate sets of
tables (CRM tables all start with `wk_`), so neither can corrupt the other.

## 2. The phone numbers — who does what

| Number | Voice (incoming calls) | Texting | Outbound caller ID |
|---|---|---|---|
| **+1 833 370 6994** | **Maya, the AI, answers** | **The warm-up line** — mass sends + replies land in the CRM inbox | ✔ |
| +1 877 419 4389 | Rings the softphone (human) | Blocked until Twilio approves | ✔ |
| +44 7426 495169 | Elsie receptionist (client-facing) | heyelsie's auto-reply | ✔ (callbacks go to the receptionist, not the CRM) |
| +44 7576 558278 | Elsie receptionist (demo line) | heyelsie's auto-reply | ✔ (same caveat) |

Key trick: a number's *calls* and *texts* route independently, which is how 833
does AI answering and CRM texting at the same time.

## 3. The lead journey, end to end

1. **Upload** — Contacts → Import CSV. Duplicates skipped, leads tagged, optionally
   fed straight into the power dialer.
2. **Blast** — Broadcasts → pick the tag → write/pick a template ({first_name}
   personalisation) → sends from 833, spaced out (default 3s apart) so carriers
   don't flag it. Live progress bar; every message on the contact's timeline.
3. **They text back** — lands in the CRM Inbox. After 45s, **the AI drafts a reply
   in Maya's voice** (draft mode: your VA taps Send/Discard; auto mode sends
   itself). Stops per lead after 5 AI replies, or the moment a human replies, or
   on stop-words ("stop", "human", "agent", "call me").
4. **They call back** — Maya answers 833, qualifies them, and books a slot via
   the booking tool: the lead is moved to the **Booked** pipeline stage, marked
   hot, a task is created for the VA, the call + AI summary land on the timeline,
   and the lead gets a confirmation text.
5. **They go quiet** — on the contact page, schedule a follow-up (1h → 1 week),
   template or free text (an *agreement* is just a template carrying the link).
   **Auto-cancels if the lead replies before it fires.**
6. **The VA closes** — softphone/power dialer calls out from any of the four
   numbers ("Calling from" selector), with live transcription + AI coach,
   recordings, outcome buttons, pipeline, leaderboard, spend caps.

## 4. Under the hood (the moving parts)

- **Database (Supabase `loggyxryrhqsbtqpteog`)** — ~44 `wk_*` tables (contacts,
  messages, calls, pipelines, broadcasts, jobs, settings…). Row-level security:
  admins = your `admin_users` allow-list; agents = `profiles.workspace_role`.
- **The job queue (`wk_jobs`)** — every delayed action (throttled broadcast
  sends, delayed AI replies, scheduled follow-ups) is a row with a "run at"
  time. A **production cron runs every minute** (`/api/cron/crm-jobs-pump`)
  and drives the worker. Proven live: a queued job is picked up within ~15s–1min.
- **Edge functions (30+, on Supabase)** — the backend: send/receive SMS, voice
  token/TwiML, dialer, jobs worker, broadcast enqueuer, draft approve, schedule
  send. Twilio webhooks are signature-checked and **fail closed** (forged or
  unsigned requests get rejected — tested).
- **AI brain (on Vercel)** — `/api/crm/ai-reply` writes the warm-up texts
  (Claude, your pitch prompt from the AI warm-up settings page); Maya's voice
  agent lives in Retell (`agent_6ee23…`) with the booking tool pointed at
  `/api/crm/book`. Post-call capture runs through `/api/webhooks/retell` —
  branch-isolated so it can never disturb the client receptionist flow.
- **Auth between the parts** — the cron↔worker↔AI-route hops authenticate with a
  dedicated `CRM_JOBS_KEY` (set on both Vercel and Supabase); user-facing
  functions require a logged-in CRM agent/admin; the booking tool requires the
  Retell tool secret.

## 5. What's ON right now

- AI text warm-up: **ON, draft mode** (45s delay, max 5/lead, Maya pitch).
- AI voice answering on 833: **ON** (Maya, books into the Booked stage).
- Broadcasts, follow-ups, dialer, softphone: live, waiting for use.
- Data: **empty** — 0 contacts/messages/calls. Fresh start as requested.

## 6. What to watch / known limits (audit list)

1. **877 texting** — carrier verification still pending (calls fine).
2. **UK callbacks** — leads ringing back a UK caller ID reach the *client*
   receptionist, not Maya. Fixed when the two pending UK numbers activate.
3. **Softphone inbound** — only 877 rings humans now (833 belongs to Maya).
4. **WhatsApp + email channels in the CRM** — copied but not switched on
   (WhatsApp needs a QR scan; email needs a routing rule).
5. **Recordings storage** — call recordings accumulate in a private bucket with
   a 90-day auto-purge; keep an eye on the Supabase storage quota.
6. **Maya's pitch is a first draft** — call 833, then refine the prompt
   (`scripts/crm-warmup-agent-prompt.txt` / AI warm-up page).
7. **CRM unit tests** — the cloned suite needs a test library install; deferred.
   The wiring suite + 161 app tests + Playwright guard tests cover the seams.

## 7. Re-run the audit anytime

```
node scripts/crm-wiring-check.mjs   # needs env keys — see script header
```
27 checks: database objects/settings, every endpoint's auth behaviour, a real
signed-webhook round trip (self-cleaning), Twilio routing per number, Retell
agent mapping, and a live "queue a job → production cron processes it" test.
