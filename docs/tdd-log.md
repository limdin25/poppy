# TDD log

How we keep Elsie launch-stable. Append a dated entry per cycle.

## Discipline

1. **Red → Green → Refactor.** For a bug, first add a failing test (e2e spec or
   vitest) that reproduces it; fix until green; then clean up.
2. **The real build check is `npx tsc -b`** (project references — matches Vercel's
   `tsc -b && vite build`). `tsc --noEmit` is a no-op here and will miss unused
   imports that fail the deploy. Always run `tsc -b` before commit.
3. **Run before every commit:** `npx tsc -b && npx vitest run`.
4. **Stable hooks for tests:** prefer `data-testid` on anything a test interacts
   with. The self-healing locator falls back to role/text and warns which testid to
   add — treat those warnings as a TODO list.
5. **CI is the gate:** `.github/workflows/tdd-gate.yml` runs typecheck + unit +
   build on every push/PR; the Playwright smoke runs against a deployed URL.
6. **Production-safety:** automated specs never mutate the real world (no sends,
   schedules, deletes, OAuth). Those live in `tests/kimi/` for human runs.

## Layout

- `tests/*.test.ts` — vitest unit/integration (node env).
- `tests/e2e/*.spec.ts` — Playwright e2e (self-healing). `helpers/healer.ts`,
  `helpers/auth.ts`.
- `tests/kimi/README.md` — human QA scripts K-001…K-012.

## Cycles

### 2026-07-20 — VM drop B7: drop counts everywhere
- **Added:** `countVoicemailDrops`/`voicemailDropsByAgent` in
  `src/features/crm/lib/callStats.ts` (drops keyed off `voicemail_dropped`
  only — never status='voicemail', which is AMD + counts as answered).
  Guard: `tests/call-stats.test.ts`.
- **Wired:** Reports KPI "VM drops" + leaderboard column; dashboard
  StatCards "VM drops today"; Leaderboard page column; live session tally
  `sessionDrops` in the dialer reducer (increments on VOICEMAIL_DROPPED,
  survives DIAL_START, resets on STOP) shown under the Start/Dial-next
  button. Guard: `tests/dialer-reducer.test.ts › sessionDrops`.

### 2026-07-20 — VM drop B6: attach-a-recording prompt
- **Added:** `validateDropRecording` (mp3/wav/m4a, ≤10 MB, extension fallback
  for missing mimes) in `src/features/crm/lib/dropRecordingValidation.ts` —
  canonical src lib instead of the spec's api/lib home because the app
  project can't import api/ (no node types); same testable-lib pattern as
  buildOutgoingTwiml. Guard: `tests/drop-recording-validation.test.ts`.
- **Added:** "Voicemail drop recording" card in Settings → campaign → Leads,
  next to the CSV upload: attach-or-skip prompt, upload to public
  `crm-attachments` (`vmdrop/{campaignId}/…`), writes
  `voicemail_recording_url`, audio preview + replace, warns when the toggle
  is still OFF.

### 2026-07-20 — VM drop B5: Drop VM button + campaign toggle
- **Added:** Drop VM button in the dialer active-call grid (replaces the dead
  "Blind" placeholder; `Voicemail` icon; greyed via the canDropVoicemail
  mirror with a hover hint saying why). Campaign settings header gets a
  "Drop VM: ON/OFF" chip, disabled until a recording exists.
- **Plumbed:** `voicemailRecordingUrl`/`voicemailDropEnabled` through BOTH
  Campaign types + BOTH useDialerCampaigns hooks (caller-pad + crm/hooks —
  row type, `.select()`, mapper). UI-only cycle; covered by the B2 eligibility
  tests + existing gate (no new unit surface).

### 2026-07-20 — VM drop B4: dialer machine wiring
- **Refactored:** dialer reducer + INITIAL extracted from `useDialerMachine.ts`
  into pure `src/features/crm/dialer-pro/reducer.ts` (no behaviour change) so
  vitest can pin it from `tests/`.
- **Added:** `voicemailDropped` state + `VOICEMAIL_DROPPED` action (reset on
  DIAL_START/STOP, survives CALL_ENDED for wrap-up display); `dropVoicemail()`
  in the hook — invokes `wk-voicemail-drop`, dispatches, frees the agent leg
  like hangUp (reason `vm_drop`), toasts. Guard: `tests/dialer-reducer.test.ts`.

### 2026-07-20 — VM drop B3: drop edge function + contact-leg SID capture
- **Added:** `executeVoicemailDrop` in `api/lib/voicemail-drop.ts` (canonical;
  Deno mirror `supabase/functions/wk-voicemail-drop/index.ts`, `verify_jwt=true`
  in config.toml). Ownership check w/ admin bypass, idempotent already-dropped
  no-op, terminal-status guard, campaign recording+toggle guards, drop POST to
  the contact leg, `voicemail_dropped` write. Guard:
  `tests/voicemail-drop.test.ts › executeVoicemailDrop` (10 cases).
- **Added (Option A):** `<Number statusCallback statusCallbackEvent="answered">`
  in both `buildOutgoingTwiml` copies. The child callback's CallSid matches no
  wk_calls row, so wk-voice-status got an early ParentCallSid-keyed capture
  branch (parallel-dial client legs skip it via the `client:` guard). Fallback
  when the capture hasn't landed: REST lookup by ParentCallSid. Guard:
  `tests/build-outgoing-twiml.test.ts` + fallback case in the executor tests.
- **Fixed:** stale CANONICAL comment in wk-voice-twiml-outgoing pointed at
  `src/features/smsv2/…`; corrected to `src/features/crm/lib/…`.

### 2026-07-20 — VM drop B2: eligibility
- **Added:** `canDropVoicemail({phase, recordingUrl, dropEnabled, alreadyDropped})`
  — true only when connected + recording present + campaign toggle on + not
  already dropped. One function drives the button `disabled` state and the
  server guard. Guard: `tests/voicemail-drop.test.ts › canDropVoicemail`.

### 2026-07-20 — VM drop B1: drop TwiML builder
- **Added:** `buildDropTwiml(recordingUrl)` in `api/lib/voicemail-drop.ts` —
  `<Response><Play>{url}</Play><Hangup/></Response>` with XML-escaped url
  (ghost-dialer's unescaped-interpolation bug pinned as a Red test), throws on
  empty/non-http urls. Guard: `tests/voicemail-drop.test.ts › buildDropTwiml`.

### 2026-06-03 — Launch hardening
- **Fixed:** inbox flicker + scrambled order — root cause was a broken poll dedup
  (`.maybeSingle()` erroring once duplicates existed → re-inserting every cron
  cycle). Dedup switched to `.limit(1)` across poll + webhook; 9,038 duplicate
  messages purged. Regression guard: `smoke.spec.ts › inbox does not flicker`
  (asserts < 80 DOM mutations / 4s).
- **Fixed:** status taxonomy unified to the deal's pipeline stage across inbox /
  pipeline / table. Covered by `leads-pipeline.spec.ts`, `leads-table.spec.ts`.
- **Added:** currency setting + propagation, inbox deal-value + Notes,
  Classification → Goals, Overview wiring (stage labels, Next-6h, avatars).
  Covered by `settings-currency.spec.ts`, `inbox.spec.ts`, `agent.spec.ts`,
  `overview.spec.ts`.
- **Fixed:** home routing — marketing apex (`heyelsie.com`) serves the landing at
  `/`; the app lives at `/dashboard` on `app.heyelsie.com`. Guard:
  `smoke.spec.ts › home routing`.
- **Built:** self-healing Playwright suite (`tests/e2e/`), Kimi scripts
  (`tests/kimi/`), CI gate (`tdd-gate.yml`). Smoke: **15/15 green** against
  production.
