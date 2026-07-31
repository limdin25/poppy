# UGC Factory environment variables

Machine-checked by `tests/unit/env-manifest.test.ts`: every `process.env.X` or
`import.meta.env.VITE_X` referenced anywhere under `ugc/` must have a row here,
and provider keys must never be referenced from `src/` or `api/` (browser and
serverless): they belong to the VPS worker only.

## Client (Vite, baked into the browser bundle)

| Var | Where set | Purpose |
|---|---|---|
| VITE_UGC_API_MODE | local dev / Vercel | `mock` runs the whole app on the deterministic in-memory backend (all e2e, zero spend); `http` talks to the real backend |
| VITE_SUPABASE_URL | Vercel (ugc-factory project) | New UGC Supabase project URL (NOT the Elsie project) |
| VITE_SUPABASE_ANON_KEY | Vercel (ugc-factory project) | New UGC Supabase anon key |

## Serverless (`ugc/api/`, Vercel only)

| Var | Where set | Purpose |
|---|---|---|
| SUPABASE_URL | Vercel (ugc-factory project) | UGC project URL for service-role calls |
| SUPABASE_SERVICE_ROLE_KEY | Vercel (ugc-factory project) | UGC project service role |
| STRIPE_SECRET_KEY | Vercel (ugc-factory project) | Shared Stripe account key |
| STRIPE_WEBHOOK_SECRET | Vercel (ugc-factory project) | The NEW ugc webhook endpoint's own signing secret |
| UGC_STRIPE_PRICE_ID | Vercel (ugc-factory project) | The 49 GBP credit pack price |
| FISH_API_KEY | Vercel (ugc-factory project) | Fish Audio TTS (voice takes run inline for a fast approve loop) |
| APP_URL | Vercel (ugc-factory project) | Public URL for Stripe redirect targets |

## VPS worker only (`ugc/worker/`, never on Vercel, never in the browser)

| Var | Where set | Purpose |
|---|---|---|
| SUPABASE_URL | VPS `/etc/ugc-worker.env` | UGC project URL |
| SUPABASE_SERVICE_ROLE_KEY | VPS `/etc/ugc-worker.env` | UGC project service role |
| GEMINI_API_KEY | VPS `/etc/ugc-worker.env` | Nano Banana image models |
| ARK_API_KEY | VPS `/etc/ugc-worker.env` | BytePlus ModelArk (Seedance) |
| BYTEPLUS_AK | VPS `/etc/ugc-worker.env` | BytePlus Vision AK (OmniHuman) |
| BYTEPLUS_SK | VPS `/etc/ugc-worker.env` | BytePlus Vision SK (OmniHuman) |
| FAL_KEY | VPS `/etc/ugc-worker.env` | fal.ai (Kling Avatar default path + fallbacks + bake-off) |
| FISH_API_KEY | VPS `/etc/ugc-worker.env` | Fish recovery path for timed-out serverless takes |
| UGC_WORKER_ID | VPS `/etc/ugc-worker.env` | Claim/heartbeat identity |

## Bench only (`ugc/bench/`, run by hand)

| Var | Where set | Purpose |
|---|---|---|
| FAL_KEY | shell | One key reaches every bake-off contender |
| GEMINI_API_KEY | shell | Nano Banana fixture + composite images |
| FISH_API_KEY | shell | The fixture voiceover takes |
| ARK_API_KEY | shell | BytePlus ModelArk (Seedance price verification, optional) |
| SUPABASE_URL | shell | Where `ugc_benchmark_runs` rows land |
| SUPABASE_SERVICE_ROLE_KEY | shell | Writes benchmark rows + uploads outputs |
| BENCH_BUDGET_USD | shell (REQUIRED, no default) | The hard cap; the harness refuses submissions past it |
| BENCH_FORCE_RESUBMIT | shell (never set casually) | Set to the EXACT spend key to unlock one crashed-mid-call entry after checking the provider dashboard; the estimate is counted against the budget again |
