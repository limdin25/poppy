<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# NextPubli — Agent Definitions

## feature-builder

Creates a new feature folder under `features/<name>/` with all required files.

**When to use:** Every time a new UI feature is needed.

**Steps:**

1. Create `features/<name>/` folder
2. Create `index.ts` (public barrel export)
3. Create main component `<Name>.tsx`
4. Create `<Name>.test.tsx` (Vitest — write FIRST, before the component)
5. Create `copy.ts` (PT-BR strings)
6. Create `mock.ts` (test data)
7. Create `README.md` (use template from `docs/ADDING-A-FEATURE.md`)
8. Run test — confirm it fails
9. Implement component
10. Run test — confirm it passes
11. Run `pnpm exec tsc --noEmit` and `pnpm exec eslint .`

## supabase-migrator

Writes and runs Supabase SQL migrations.

**When to use:** Any database schema change.

**Steps:**

1. Read Supabase docs first: https://supabase.com/docs
2. Create migration file in `supabase/migrations/`
3. Include RLS policies in the same migration
4. Update `types/database.ts` to match new schema
5. Update `schemas/` Zod validators if affected
6. Run `pnpm exec tsc --noEmit` to verify types

## playwright-e2e

Writes and runs Playwright e2e tests for routes.

**When to use:** Every new top-level route or user flow.

**Steps:**

1. Create test in `tests/e2e/<route-name>.spec.ts`
2. Write the test FIRST (TDD)
3. Run `pnpm exec playwright test <file>` — see it fail
4. Implement the route/feature
5. Run test again — see it pass

## doc-reader

Fetches and reads official API documentation before any integration work.

**When to use:** Before writing ANY code that calls an external API.

**Steps:**

1. Fetch the official documentation URL from the table in CLAUDE.md
2. Read and understand auth flow, endpoints, rate limits, error codes
3. Summarize key points relevant to the implementation
4. Only then proceed to write code

## browser-tester

Tests features and fixes in Hugo's real browser via Kimi WebBridge.

**When to use:** Every feature or bug fix that has a UI component. Run AFTER code passes
TypeScript and linting checks, BEFORE marking task as done.

**Pre-requisites:**

1. Tell Hugo which browser sessions are needed (see login checklist in CLAUDE.md)
2. Wait for Hugo to confirm he's logged in
3. Check daemon: `~/.kimi-webbridge/bin/kimi-webbridge status`
4. Confirm `running: true` and `extension_connected: true`

**Steps:**

1. Start dev server if not running (`pnpm dev`)
2. Navigate to the page under test via Kimi WebBridge
3. Take a snapshot — read the page structure
4. Click through the golden path (happy flow)
5. Test edge cases (empty states, errors, missing data)
6. Screenshot any issues
7. If issues found → fix code → re-test
8. Only mark DONE when the flow works visually in the browser

**Key commands:**

```bash
# Health check
~/.kimi-webbridge/bin/kimi-webbridge status

# Navigate
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"navigate","args":{"url":"URL","newTab":true},"session":"SESSION"}'

# Read page
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"snapshot","args":{},"session":"SESSION"}'

# Click
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"click","args":{"selector":"@eREF"},"session":"SESSION"}'

# Type into field
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"fill","args":{"selector":"@eREF","value":"TEXT"},"session":"SESSION"}'

# Screenshot (use helper script — never call API directly)
bash ~/.claude/skills/kimi-webbridge/scripts/screenshot.sh -s SESSION
```

**Full docs:** `~/.claude/skills/kimi-webbridge/SKILL.md`

## task-planner

Plans work and presents Hugo with a login checklist before starting.

**When to use:** At the start of every non-trivial task.

**Steps:**

1. Read the task requirements
2. Identify which browser sessions will be needed for testing
3. Present Hugo with the login checklist (see CLAUDE.md "Pre-task login checklist")
4. Wait for Hugo to confirm
5. Then proceed with the work
