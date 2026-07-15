# CRM Port Audit — hub.nfstay.com/crm → app.heyelsie.com/admin/crm

Audit date: 2026-07-15. Six-agent deep audit of both codebases (nfstay repo at
`/Users/hugo/Downloads/AI Folder/nfstay`, Elsie repo here). This doc is the
distilled result + implementation plan. Status: **awaiting Hugo's go-ahead on
the decisions at the bottom.**

---

## What the "CRM" actually is

The thing at hub.nfstay.com/crm is the `smsv2` feature module (renamed "CRM" in
PR 45). It is a full sales call-centre, not a simple contacts page:

- **Browser softphone** — call from the browser via Twilio Voice SDK
- **Power dialer** (`dialer-pro`, separate feature folder, imports ~20 smsv2 modules — must port together)
- **Unified inbox** — SMS + WhatsApp + email threads
- **Contacts** (CSV import/export), **Pipelines** (kanban), **Templates**, **Reports**, **Leaderboard**
- **Live AI coach** — real-time transcription (Twilio native) + OpenAI coaching cards during calls
- **Post-call AI** — Whisper transcription + GPT summary
- **Agent management** — create/delete agent logins, per-agent daily spend caps, kill switches, supervisor listen-in
- **Settings** — Twilio connect, number management, campaigns, AI settings (2,400-line page)

### Size
- Frontend: 138 files in `src/features/smsv2` + 7 files (~3k LOC) in `src/features/dialer-pro`
- Backend: 31 Deno edge functions (`wk-*`) on NFStay's Supabase — voice token, TwiML, dialer, SMS in/out, email, AI, jobs worker, spend
- Database: 43 `wk_*` tables + ~20 Postgres RPCs/triggers + 4 pg_cron jobs + 2 storage buckets (private `call-recordings`, public `crm-attachments`)
- State: heavy Supabase Realtime (34 files subscribe), React Context store, ~38 bespoke hooks

---

## Headline findings

1. **An iframe embed won't do what Hugo wants.** Connecting Elsie's Twilio
   numbers + Supabase means a real port: tables into `loggyxryrhqsbtqpteog`,
   backend functions redeployed, webhooks repointed.

2. **Inbound calls/SMS cannot share the existing Elsie numbers.** Verified live:
   both UK numbers (+447426495169, +447576558278) are assigned to Retell's SIP
   trunk `TK6634fb…`. A Twilio number's inbound voice routing is EITHER the SIP
   trunk (Retell answers) OR a voice webhook (CRM softphone rings) — one
   setting. Same for SMS: one inbound webhook slot per number, and Elsie's
   `twilio-sms.ts` auto-replies to every text (would pitch CRM prospects).
   **⇒ CRM needs its own UK number (~£1/mo).** Outbound-only caller ID sharing
   is possible but causes: callbacks answered by the AI receptionist, BRRR
   30-min spacing defeated, history split across two schemas. Not recommended.

3. **Elsie's Twilio account has no TwiML App and no API Key** (verified live via
   REST). Both are required for the browser softphone. Both can be created
   programmatically with the env creds — no Comet/console task needed.

4. **Elsie has no `profiles` table.** The CRM keys everything (roles, caller ID,
   agent status) off `profiles.workspace_role` etc. Port needs a small new
   table (e.g. `wk_agents`) keyed to auth.users, and `wk_is_admin()` rewritten
   to check Elsie's `admin_users` (replacing THREE hardcoded NFStay admin-email
   lists: `src/core/auth/useAuth.ts`, `useInboxThreads.ts`, SQL `wk_is_admin()`).

5. **Elsie has zero Supabase Edge Functions today** (100% Vercel `api/*`, edge
   runtime, 15 crons). The 31 CRM functions are Deno. Recommended: deploy them
   as Supabase Edge Functions on Elsie's project (near-verbatim port, no 25s
   Vercel edge timeout risk for recording downloads / long webhooks). Rewriting
   31 functions as Vercel routes is the higher-risk alternative.

6. **Known bugs in the source to fix during port** (do NOT port verbatim):
   - `wk-jobs-worker` / `wk-dialer-tick` have NO scheduler despite comments
     claiming pg_cron — queued SMS/post-call jobs sit until the next call event.
     Port must add a real cron.
   - `wk-voicemail-transcribe` is referenced by inbound TwiML but doesn't exist
     (voicemail callback 404s today).
   - `wk-sms-incoming` accepts unsigned webhooks when auth token env is empty;
     silently drops on invalid signature.
   - `wk_dialer_queue.status` CHECK constraint doesn't include `'lost'` but
     functions write it (constraint dropped by hand in prod) — replaying
     migrations verbatim breaks strike-losers. Take FINAL RPC versions only
     (`wk_pick_next_lead` = 20260430000180, `wk_apply_outcome` = 20260430000140).
   - `wk_calls` + `wk_dialer_queue` realtime was enabled by dashboard hand-edit,
     not migrations — Elsie migration must add all subscribed tables to the
     publication explicitly.
   - Legacy coupling: `wk-sms-incoming` dual-writes NFStay's old `sms_*` tables;
     `wk-jobs-worker` delegates to legacy `sms-send`. Elsie has neither — cut
     the bridge, inline the Twilio send.
   - Plaintext secrets in DB rows (`wk_ai_settings.openai_api_key`,
     `wk_twilio_account.auth_token`) — move to env-only in the port.
   - Twilio Client identity MUST be the bare profile UUID (colon suffixes break
     SIP bridging, Twilio error 13224 — PR 145).
   - `buildOutgoingTwiml` is duplicated frontend + edge fn, pinned by vitest —
     keep both copies in sync.

7. **Scope cuts recommended for v1** (all confirmed low-coupling):
   - `wk-ai-live-coach` — officially deprecated (replaced by
     `wk-voice-transcription`); also a WebSocket server, can't host on Vercel.
   - Agreements feature (`SendAgreementModal`, 2 imports) — stub it; removes the
     `sonner` dep entirely.
   - BRRRR/tinder imports (`BrrrrDetailModal`, `BrrrrCallPanel`) — strip.
   - WhatsApp channel — runs through NON-wk functions (`unipile-send`,
     `unipile-webhook`, `unipile-poll-messages` with hardcoded NFStay project
     URL + secret) — phase 2, possibly bridged to Elsie's existing Unipile.
   - Email channel — Elsie already has Resend inbound (`resend-inbound.ts`,
     heypubli.com) ingesting into Elsie conversations; CRM email needs a
     recipient-routing rule to avoid double-ingest — phase 2.
   - Voicemail-to-text — net-new code (never existed); v1 = record only.
   - `wk-diag` (source says "should be REMOVED"), `wk_voice_sessions` (dead),
     `wk_call_recordings` table ref in caller-pad (no migration creates it — dead).

8. **Version/dep deltas**: nfstay is React 18.3/TS 5.8; Elsie is React 19.2/TS 6.
   Adds needed: `@twilio/voice-sdk`, `papaparse`, `react-resizable-panels`
   (React-19-safe). `react-day-picker` 8.x peers on React ≤18 — replace its one
   usage. `@tanstack/react-query` used in exactly ONE hook — rewrite that hook
   instead of adding the dep. `@/*` alias exists in Elsie, but
   `@/components/ui/*` + `@/lib/utils` targets don't — shim to `src/core/ui` +
   `src/core/lib/cn`. NFStay branding sweep list: NfsLogo, `nfstay_pause_speed_dialer`
   localStorage key, `nfstay-pause-dialer` window event, CSV filenames,
   hardcoded `asazddtvjvmckouxcmmo` webhook URLs in SettingsPage.tsx:1487.

9. **Env/infra facts (verified live)**:
   - Elsie realtime publication currently: conversations, messages, calls,
     billing_periods, agents only.
   - Elsie buckets: `media` + `uploads`, both public. Need private
     `call-recordings` + retention purge from day one (media bucket already
     caused the 2026-06-02 quota outage; recordings are unbounded audio —
     confirm Supabase spend cap before enabling ingest).
   - pg_cron/pg_net NOT installed but available (1.6.4 / 0.20.0) —
     `CREATE EXTENSION` in migration, or use Vercel crons.
   - `OWNER_EMAIL` not set in Vercel (require-admin.ts second-admin 403 concern
     is moot today). `OPENAI_API_KEY` not in Vercel; a key exists in Claude
     memory (`reference_openai_key.md`) — billing headroom unverified.
   - `admin_users` = hugodesouzax@gmail.com + demo.super@heyelsie.com.
   - +447426495169's `sms_url` still points at dead legacy.hostunico.com —
     inbound SMS to the main line is lost today (fix deliberately while in there).
   - Canonical webhook domain: `https://app.heyelsie.com` (never
     poppy-henna.vercel.app). Twilio signature validation reconstructs the
     public URL — must match exactly.

### New env vars needed
`TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_TWIML_APP_SID` (all
creatable via script), `OPENAI_API_KEY` (from memory), `USD_TO_GBP` (0.79),
`CRM_EMAIL_FROM` (phase 2). Existing reused: `TWILIO_ACCOUNT_SID/AUTH_TOKEN`,
`SUPABASE_URL/SERVICE_ROLE_KEY`, `RESEND_*`.

---

## Implementation plan (phased)

**Phase 1 — Database.** One consolidated Elsie migration: the ~40 needed `wk_*`
tables (final RPC versions, `'lost'` in the queue CHECK), new `wk_agents` table
replacing `profiles` columns, `wk_is_admin()` → `admin_users` lookup, realtime
publication adds (incl. wk_calls, wk_dialer_queue), private `call-recordings` +
`crm-attachments` buckets + policies, pg_cron jobs (spend reset, hot recompute,
recordings retention, stale-call sweep) + a jobs-worker pump schedule.

**Phase 2 — Backend.** Deploy ~22 of the 31 `wk-*` functions to Elsie's
Supabase (skip deprecated/dead/phase-2 ones). Fix the port-blocking bugs listed
above. Set Supabase edge secrets.

**Phase 3 — Twilio (scripted, no dashboards).** Create API Key + TwiML App via
REST; buy 1 new UK number; point its Voice URL → `wk-voice-twiml-incoming`,
SMS URL → `wk-sms-incoming`; seed `wk_numbers`. Existing Retell numbers
untouched.

**Phase 4 — Frontend.** Copy `smsv2` + `dialer-pro` into
`src/features/crm/`, strip NFStay branding/tinder/agreements, shim UI imports
to `src/core/ui`, add deps, mount at `/admin/crm/*` inside AdminApp behind
AdminGuard (CRM keeps its own inner sidebar; CrmGuard/AdminOnlyRoute replaced
by admin_users). Add "CRM" to AdminLayout navGroups.

**Phase 5 — Verify.** `npx tsc --noEmit && npx vitest run` (port the pinned
TwiML tests), Playwright e2e, then a real test call + SMS on the new number
end-to-end (softphone dial out, inbound ring, recording ingest, transcript).

---

## Decisions (Hugo, 2026-07-15)

1. **Sales agents too** — full agent system (create-agent, roles, spend caps,
   leaderboard, supervisor listen-in) ports as functional. Agents log into the
   CRM only — never the rest of /admin. CRM mounts at /admin/crm behind its own
   CrmGuard (admin_users OR profiles.workspace_role), not AdminGuard.
2. **Start empty** — no NFStay data. ZERO NFStay mentions/branding anywhere.
3. **CLONE, DON'T TOUCH (Hugo's hard rule).** The live hub.nfstay.com/crm, its
   Supabase, and the ex-NFStay Twilio account (which holds 33 UK dialer
   numbers) stay 100% untouched — read the source code, change nothing, no
   cutover step exists. The clone integrates ONLY Elsie's stack: Elsie Twilio
   account ACa694e1c2…, Elsie Supabase loggyxryrhqsbtqpteog, Elsie Vercel,
   Elsie repo. Number dropdown = whatever is in the Elsie Twilio account,
   synced via the CRM's own number-sync: today +447426495169 and +447576558278
   (Retell lines — CRM outbound caller ID only; their inbound stays with
   Retell) and +18774194389 / +18333706994 (US toll-free, unused — can take
   full CRM inbound/outbound). Two UK numbers pending regulatory approval
   (+447863753339, +447307200470) will appear in the dropdown automatically
   once Twilio activates them, and can then take CRM inbound voice + SMS.
4. **All channels** — calls + SMS first, WhatsApp + email immediately after
   (WhatsApp via Unipile bridge; email via Resend with recipient routing).
5. **Keep OpenAI** (Whisper + gpt-4o-mini + coach); key moves to env, not DB.

Build addendum: Elsie gets a `profiles` table (it has none today) matching the
columns ported code expects (workspace_role, agent_extension, agent_status,
default_caller_id_number_id) — avoids rewriting hundreds of `profiles`
references. Keep `wk_*` table names verbatim for the same reason.

Full per-area audit reports (frontend / backend / data model / Elsie admin /
Twilio routing / gap analysis) were generated 2026-07-15; key facts are all
distilled above.
