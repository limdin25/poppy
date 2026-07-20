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
