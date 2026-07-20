# BUILD PROMPT — Agent-pressed Voicemail Drop for the CRM speed dialer (strict TDD)

*Paste everything below into a fresh Claude Code window opened at `/Users/hugo/Whats/Poppy`. It is self-contained: every integration point was pre-verified against the live code and is cited by `file:line`. Do not re-research what's already stated here — spot-check, then build.*

> ## HOW TO RUN THIS BUILD
> **Build the ENTIRE feature in one session — all 8 behaviours, start to finish. Do not stop halfway to ask for confirmation.** The owner trusts the build; there are no blocking questions.
>
> **BUT DO NOT MAKE IT LIVE.** Build in the working tree, keep the green gate passing, commit locally per behaviour. Then STOP. Specifically:
> - **Write** the migration file — but **do NOT apply it to production** (`loggyxryrhqsbtqpteog`). Applying it is the owner's go-live step.
> - **Do NOT deploy** any edge function or frontend to Vercel/Supabase. Do NOT `git push`. Do NOT run any Supabase/Vercel deploy command.
> - The only manual go-live steps (which the owner does later) are collected in the final "GO-LIVE (owner does this, not you)" section. Do not perform them; just build the code so they're all that's left.

---

## 0. What you're building (and what you're NOT)

A **voicemail drop** on the existing CRM speed dialer (`src/features/crm/dialer-pro`). The agent is already live on every call. When the agent's ear hears a voicemail greeting, they tap **"Drop VM"**; the system plays a pre-recorded audio file into the contact's call leg and instantly frees the agent to advance to the next lead. The agent's ear is the answering-machine detector — **there is NO Twilio AMD, no async detection, no automatic drop**. This is the industry-standard power-dialer drop (PhoneBurner/Kixie style).

Read `docs/VMDROP_RESEARCH.md` first (the Phase-0 research). This build is the "agent-pressed drop" it recommends — the simplest, cleanest-legally variant (a live human is on every call; only the voicemail message is pre-recorded).

**Requirements from the owner (Hugo), verbatim intent:**
1. **Drop VM is a per-campaign toggle** (on/off). **If no recording is uploaded for the campaign, the toggle is inactive/greyed.**
2. **When a new lead list is uploaded, prompt "attach/upload a voicemail recording for this campaign?"** (upload now, or skip).
3. **Show the drop count in every statistics surface** (dashboard, reports, leaderboard, live session).
4. **When a dropped contact comes back, flag it — keep it simple.** If we voicemail-dropped someone and they later **call back OR text back**, and **whether we answer it or miss it**, the system must make it obvious that "this is a person we dropped a voicemail to, and they're back." Concretely: add a **permanent tag** (`called-back`) and move them to the **"Call back" pipeline column** (the existing `Voicemail`/Callback column). It must fire the instant their inbound call/text reaches us — so a *missed* callback is flagged just as much as an answered one. Easy to identify at a glance; nothing more elaborate than that.
5. Hugo will **test by calling our own numbers** — make the happy path work end-to-end on a real call.

**Owner rules (from CLAUDE.md — non-negotiable):** Read files before editing. Never `sed` .ts/.tsx. Never touch `vite.config.ts`/`src/main.tsx` without asking. Destructive/shared-state actions (dropping data, deploying) — stop and ask. Zero TS errors. No hardcoded secrets (env vars only). Feature-module pattern — do NOT break the dialer, softphone, inbound, or the Retell path. Mobile-first. Keep the existing approved styles.

**Green gate before every commit** (note `tsc -b`, not `--noEmit`):
```bash
npx tsc -b && npx vitest run
```
Commit once per behaviour, Red → Green → Refactor. Append a dated cycle entry to `docs/tdd-log.md` per behaviour (format: `### YYYY-MM-DD — <title>` under `## Cycles`, bullets `- **Added:** …` naming the guard test).

---

## 1. The exact mechanism (pre-verified — this is the load-bearing part)

### Call topology on the speed-dialer path
`dialer-pro` dials via the **browser Twilio Device** (`useDialerMachine.ts:342-345` → `twilioDial({to, extraParams:{CallId,ContactId}})`), so `From=client:<uuid>`. Twilio's TwiML App POSTs `wk-voice-twiml-outgoing`, which (identity-present branch) returns `buildOutgoingTwiml(...)` (`wk-voice-twiml-outgoing/index.ts:316-322`). The returned `<Dial>` (built at `:71-79`):

```xml
<Dial callerId="+…" answerOnBridge="true" timeout="60" record="record-from-answer-dual"
      recordingStatusCallback="{PUBLIC_FN_BASE}/wk-voice-recording"
      recordingStatusCallbackEvent="completed"
      action="{PUBLIC_FN_BASE}/wk-voice-status" method="POST">
  <Number>+<contact></Number>
</Dial>
```
- Agent browser = **parent** leg; `<Number>` = **child** (contact PSTN) leg; bridged.
- Nothing runs after `</Dial>`; because `action=` is set, Twilio follows whatever `wk-voice-status` returns — an empty `<Response/>` (`wk-voice-status/index.ts:466-469`) → **hangs up the agent parent leg**. So redirecting the child auto-frees the agent.

### ⚠️ THE GOTCHA — the contact leg's CallSid is NOT captured today
`wk_calls.contact_twilio_call_sid` is only set by `wk-voice-status:328-334` (`if From=<number>, To!=client:` → contact leg). But on the speed-dialer path the `<Number>` child **has no `statusCallback`**, so Twilio never posts the child's SID → `contact_twilio_call_sid` stays **NULL**. The drop MUST target the child leg's SID. **Two ways to get it — pick ONE:**

- **Option A (recommended): capture it.** Add `statusCallback="{PUBLIC_FN_BASE}/wk-voice-status" statusCallbackEvent="answered"` to the `<Number>` in `buildOutgoingTwiml` (`wk-voice-twiml-outgoing/index.ts:77`). The existing capture branch (`wk-voice-status:332`) already handles `From=<number>,To=<contact>` and writes `contact_twilio_call_sid`. **Keep the canonical mirror in sync** — `buildOutgoingTwiml` is duplicated; the comment at `wk-voice-twiml-outgoing/index.ts:54` names the canonical copy (`src/features/…/lib/buildOutgoingTwiml.ts`). Edit both. This is the cleaner long-term fix and makes the SID queryable for stats too.
- **Option B: derive at drop-time.** In `wk-voicemail-drop`, if `contact_twilio_call_sid` is null, `GET https://api.twilio.com/2010-04-01/Accounts/{SID}/Calls.json?ParentCallSid={parent_twilio_call_sid}` and take the child SID. No TwiML change, but an extra REST round-trip per drop.

Prefer **A**; fall back to B inside the function for robustness.

### The drop REST call (copy this exact pattern)
From `wk-dialer-hangup-leg/index.ts:117-137` — same auth/encoding, just swap the body:
```ts
await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${contactLegSid}.json`,
  { method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      Twiml: `<Response><Play>${recordingUrl}</Play><Hangup/></Response>`,
    }).toString(),
  });
```
`Twiml=` on the Calls resource replaces the child leg's executing TwiML → it leaves the bridge, plays the file, hangs up. Free the agent client-side with the existing `twilioCall.disconnect()` (`useDialerMachine.ts:416`) right after the drop resolves.

### Recording URL must be publicly fetchable by Twilio
Twilio fetches the `<Play>` URL. The private `call-recordings` bucket won't work without signing. **Upload the campaign drop recording to the `crm-attachments` bucket** (public read, authenticated write — `crm_port.sql:2596+`) and store its public URL. (Or `createSignedUrl` with long expiry — but public `crm-attachments` is simpler and the audio is your own outbound message.) Accept `audio/mpeg,audio/wav,audio/mp4` ; validate mime.

---

## 2. Schema — one migration

New file: `supabase/migrations/20260720000001_dialer_voicemail_drop.sql` (idempotent; RLS is already ON for these tables via the enable-loop — new columns inherit existing policies).

```sql
-- Per-campaign voicemail drop config
ALTER TABLE wk_dialer_campaigns
  ADD COLUMN IF NOT EXISTS voicemail_recording_url text,
  ADD COLUMN IF NOT EXISTS voicemail_drop_enabled  boolean NOT NULL DEFAULT false;

-- Per-call: was a drop played (orthogonal to status; keeps answer-rate math intact)
ALTER TABLE wk_calls
  ADD COLUMN IF NOT EXISTS voicemail_dropped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voicemail_dropped_at timestamptz;
```
`wk_dialer_campaigns` schema is at `crm_port.sql:287-304`; `wk_calls` at `:347-376`. Do NOT overload `status='voicemail'` — that already means "AMD detected a machine" and is bucketed as *answered* in stats (`useReports.ts:97-105`); a drop is a separate concept. **Write this migration file, but do NOT apply it to prod** (`loggyxryrhqsbtqpteog`) — applying it is the owner's go-live step (see final section). The file itself is safe/idempotent.

---

## 3. Behaviour-by-behaviour TDD plan (Red → Green → commit each)

Pure logic goes in `api/lib/*.ts` and is tested under `tests/*.test.ts` — **`src/features/crm/**` is excluded from vitest** (`vitest.config.ts`). Import libs with the **`.js`** extension (Vercel node16). Mirror-lib template: `api/lib/twilio-lookup.ts` + `tests/twilio-lookup.test.ts`. DB-handler mock template: `tests/call-delivery-tools.test.ts` (`makeSupabase()` chain-mock + `Request` object).

**Behaviour 1 — Drop TwiML builder.** `api/lib/voicemail-drop.ts` → `buildDropTwiml(recordingUrl): string` returns `<Response><Play>{escaped url}</Play><Hangup/></Response>`. Test: valid url → correct XML; url with `&` → XML-escaped (no injection — this was ghost-dialer's bug, see research §5). Empty/invalid url → throws.

**Behaviour 2 — Drop eligibility.** `canDropVoicemail({phase, recordingUrl, dropEnabled, alreadyDropped}): boolean` → true only when `phase==='connected' && recordingUrl && dropEnabled && !alreadyDropped`. Tests cover each false branch. This drives both the button `disabled` state and the server guard.

**Behaviour 3 — `wk-voicemail-drop` edge function** (new; `verify_jwt=true`; JWT-check like `wk-dialer-hangup-leg:46-53`; CORS block like `wk-calls-create:23-28`). Loads `wk_calls` by `call_id`, verifies `row.agent_id===agentId` (or admin), resolves the contact leg SID (Option A column, else Option B fetch), POSTs the drop, sets `wk_calls.voicemail_dropped=true, voicemail_dropped_at=now()`. Extract the pure decision logic (ownership check, SID resolution, body building) into `api/lib/voicemail-drop.ts` and test there; keep the Deno `index.ts` a thin shell that mirrors it. Tests: not owner → 401/403; no recording on campaign → 400; happy path → correct Twilio URL + `voicemail_dropped` write.

**Behaviour 4 — machine wiring.** In `useDialerMachine.ts`: add `dropVoicemail()` alongside `sendDigit`/`holdToggle` (`:422-462`), expose in the return (`:542-562`); add `voicemailDropped:boolean` to state (`types.ts:23-40`), action `{type:'VOICEMAIL_DROPPED'}` (`types.ts:42-58`), reducer case + reset on `DIAL_START` (`useDialerMachine.ts:37-51`). `dropVoicemail` invokes `wk-voicemail-drop`, then `twilioCall.disconnect()`, `onToast('Voicemail dropped','success')`, dispatches `VOICEMAIL_DROPPED`. (This is UI/hook code — cover the reducer logic via a pure reducer test if you extract it; otherwise manual + e2e. Keep the reducer a pure function so it's testable.)

**Behaviour 5 — the button + toggle (UI).** `DialerProPage.tsx`: add a **Drop VM** button in the active-call control grid (`:883-967`; replace a dead placeholder `Blind`/`Warm` at `:897-906`, or add a 3rd row). `disabled={!canDropVoicemail(...)}`; greyed style `text-[#9CA3AF] cursor-not-allowed` when disabled; `lucide-react` `Voicemail` icon; `cn` from `@/core/lib/cn`; brand `#3C5A87`. The recording lives on the campaign object `camp` (`DialerProPage.tsx:120-123`); add `voicemailRecordingUrl?`/`voicemailDropEnabled?` to the `Campaign` type (`caller-pad/types/index.ts:125-144`) + `WkCampaignRow` + `.select()` + `rowToCampaign` mapper (`useDialerCampaigns.ts:13-24,37-79`). **Per-campaign settings toggle**: a switch in the campaign settings that flips `voicemail_drop_enabled`, **disabled/greyed when `!voicemailRecordingUrl`**.

**Behaviour 6 — upload-a-recording prompt.** In the campaign-scoped list upload (`SettingsPage.tsx:724-796`, `CampaignLeadsCsvPanel`, the "Upload leads" card): after/next to CSV upload, add **"Attach a voicemail recording for this campaign?"** — an audio file input that uploads to `crm-attachments` (client-side pattern: `ProfileSection.tsx:33-35` `supabase.storage.from(...).upload(...).getPublicUrl(...)`), then writes `wk_dialer_campaigns.voicemail_recording_url`. Skippable. If skipped and no existing recording, the drop toggle stays greyed (Behaviour 5). Extract the upload validation (mime/size) into a testable `api/lib` helper for a Red test.

**Behaviour 7 — statistics.** Add `voicemail_dropped` to the `.select()` in `useReports.ts:74` + `useDashboardStats.ts:58`; compute `voicemailsDropped = calls.filter(c=>c.voicemail_dropped).length`; surface a KPI card in `ReportsPage.tsx:43-54` + `StatCards.tsx:16-48` + per-agent column in the leaderboard (`ReportsPage.tsx:88-133` / `LeaderboardPage.tsx:39-135`). Add a **live session "Dropped" counter** — there's no session tally today, so add a tiny `sessionStats` reducer in `useDialerMachine` (increment on `VOICEMAIL_DROPPED`) surfaced in `DialerProPage`. Put the bucket/aggregation logic in a pure `api/lib/call-stats.ts` and test it (input rows → correct counts).

**Behaviour 8 — callback attribution (keep it simple — see Requirement #4).** When a contact we voicemail-dropped comes back — **inbound call OR inbound text, answered OR missed** — tag them permanently (`called-back`) and move them to the "Call back" column. Put the decision in a pure `api/lib/callback-attribution.ts` (`shouldAttributeCallback(contact, recentDroppedCalls): {tag, moveToColumn} | null`) and test it, then wire into the CRM inbound webhooks **only** (not the heyelsie `api/webhooks/twilio-sms.ts`):
  - **Voice**: `wk-voice-twiml-incoming/index.ts` — do this **at the very start of the inbound handler, before routing to agent or voicemail** (so a *missed* callback is flagged too). After the number lookup (`:90`), match caller `from` → `wk_contacts` (use phone-variants like the SMS path); check for a recent `wk_calls WHERE contact_id=? AND direction='outbound' AND voicemail_dropped=true AND started_at > now()-30d`; if found → upsert tag `'called-back'` (idempotent, pattern `wk-sms-incoming:242-250`) + move to the **existing `Voicemail`/Callback column** (`requires_followup=true`, `crm_port.sql:2710`; look up by `ilike('name','voicemail')`). Also set `contact_id` on the inbound `wk_calls` insert (`:117-126`). This runs regardless of whether the call is then answered by an agent or dropped to voicemail — the tagging is independent of the outcome.
  - **SMS**: `wk-sms-incoming/index.ts` — same check + tag + move, inside the `if (contactId)` existing-contact block (`:237-251`), only when the contact pre-existed.
  - **Permanent tag** = `wk_contact_tags` row (`crm_port.sql:277-284`, UNIQUE `(contact_id,tag)`); nothing deletes it → permanent. It auto-renders on contact detail / pipeline card / live-call meta (no UI change). Result: at a glance you see the `called-back` chip + the contact sitting in the "Call back" column.

**Note (not a blocker — build it anyway):** this fires wherever the CRM inbound webhook is actually reached, i.e. for any number whose Twilio **Voice URL → `wk-voice-twiml-incoming`** and **SMS URL → `wk-sms-incoming`**. Build the logic fully; it will simply activate for any number wired that way. Pointing a CRM number's inbound URLs at these functions is a go-live step (listed in the final section), not something to solve in code. Do NOT add a blocking check or a question about this — just leave a one-line code comment noting the dependency.

---

## 4. UK vs US note
The drop mechanism is country-agnostic (pure call control; no AMD, so no UK detection-accuracy problem). What gates each country is the **caller-ID number**: US is ready (US numbers exist); UK needs a voice-enabled UK outbound number that isn't locked to the Retell trunk, and **never dial UK from a US toll-free** (blocked). This doesn't change the code — build once, works for both; just confirm a valid from-number per country before live UK calls.

---

## 5. Testing
- Automated: the pure-lib Red/Green tests above under `tests/`. Automated tests must **never place a real call** (CLAUDE.md). Gate: `npx tsc -b && npx vitest run`.
- Live: Hugo will call **our own numbers** — verify the full loop manually once: dial a number that goes to voicemail → tap Drop VM → the recording plays into the voicemail, the agent is freed and advances, `wk_calls.voicemail_dropped=true`, the stat increments, and (if inbound URLs are wired) calling back tags `called-back` + moves the contact to the Voicemail/Callback column.

---

## 6. Deliverable checklist (all built in this one session; nothing deployed)
- [ ] Migration `20260720000001_dialer_voicemail_drop.sql` — **written only, NOT applied to prod**
- [ ] `wk-voicemail-drop` edge fn + `config.toml` entry (`verify_jwt=true`)
- [ ] `buildOutgoingTwiml` `<Number>` statusCallback (both canonical + mirror) — Option A
- [ ] `api/lib/{voicemail-drop,call-stats,callback-attribution}.ts` + tests
- [ ] Dialer: `dropVoicemail()`, state/action, Drop VM button (greyed when ineligible)
- [ ] Campaign settings toggle (greyed when no recording)
- [ ] List-upload "attach a recording?" prompt → `crm-attachments` upload
- [ ] Drop count in dashboard + reports + leaderboard + live session
- [ ] Callback attribution in `wk-voice-twiml-incoming` + `wk-sms-incoming` (tag + column)
- [ ] `docs/tdd-log.md` cycle entries; green gate passing; zero TS errors; committed locally (no push, no deploy)
- [ ] Do NOT touch the Retell path, heyelsie `api/webhooks/twilio-sms.ts`, or existing dialer/softphone/inbound behaviour

---

## 7. GO-LIVE — the owner does this later, NOT you

When the build is done, STOP and report. Do **not** perform any of the following — just list what's left so the owner can flip it live:
1. **Apply the migration** to prod (`loggyxryrhqsbtqpteog`).
2. **Deploy** the new/changed edge functions (`wk-voicemail-drop`, `wk-voice-twiml-outgoing`, `wk-voice-twiml-incoming`, `wk-sms-incoming`) + the frontend.
3. **Upload a voicemail recording** to a campaign and flip its drop toggle on.
4. **Point the CRM outbound number's Twilio inbound URLs** (Voice → `wk-voice-twiml-incoming`, SMS → `wk-sms-incoming`) so callbacks get tagged — this is what activates Behaviour 8 for that number. (The UK numbers currently route inbound to Retell's SIP trunk, so they won't tag callbacks until repointed / a dedicated CRM number is used.)
5. **Live smoke test** by calling our own numbers: dial → voicemail → Drop VM → confirm the recording plays, the agent frees, the stat increments, and a call-back/text-back tags `called-back` + moves the contact to the Call back column.
```
