# OpenRent worker — working notes

Always-on Python+Playwright robot for the **Unico** OpenRent outreach feature. It
logs into OpenRent accounts (each via its own FlashProxy IP), scrapes pasted
search URLs for **new** listings, AI-messages landlords in rotation, and syncs
replies into the Unico app via Supabase. This is the "brain"; the Unico repo
(`/Users/hugo/Whats/Unico`) holds the UI + API + DB.

## Critical
- **Never deploy this to Vercel** — it needs a real browser + proxy. Runs on
  Hugo's Mac first, then a small always-on Linux box (Docker, `restart: always`).
- Reads/writes the **Unico Supabase** (`ceoizvfxjpzelmzwmnlt`) directly with the
  service-role key in `config.json` (gitignored). It does NOT call the app's
  authed routes — except `POST {app_url}/api/openrent/draft` for AI text, guarded
  by `worker_secret`.
- Full design + decisions: Unico memory `[[openrent-outreach]]`. Selector map:
  `[[openrent-dom]]`. Proxy creds: `[[flashproxy-proxy]]`. Plan:
  `~/.claude/plans/new-folder-but-same-merry-brooks.md`.

## Architecture
- `worker.py` — the engine: scheduler, distributed scrape, "only new" filter,
  rotation, blacklist, daily limits, active hours, AI replies (delay), queued
  sends, logging, countdowns. **This logic is done — don't rebuild it.**
- `db.py` — Supabase helpers. `flashproxy.py` — proxy string → Playwright dict.
  `llm.py` — calls the app's draft route.
- `browser_util.py` — **self-healing** (dependency-free, unit-tested in
  `test_self_heal.py`): `nav()` = page.goto with a 45s timeout + retry (used by
  ALL 4 site modules + login, never raw `page.goto`); `heal_action(fails)` =
  none/recycle/reset tiers. `Sessions.note_failure/note_success/recycle/reset/heal`
  rebuild a wedged browser+proxy instead of reusing a stuck tab forever (the old
  "Inbox read failed: Timeout" loop). After edits: `python -m unittest test_self_heal`.
- The **5 browser actions** are the only per-site pieces, filled from the Comet
  DOM map:
  - `openrent_login.py` — DONE (Path B `/account/simplelogon`, no captcha).
  - `openrent_listing.py` — `scrape_search` / `scrape_listing` (Comet B2 1-2). TODO.
  - `openrent_enquiry.py` — `send_enquiry` (Comet B2 3-4). TODO.
  - `openrent_inbox.py` — `read_inbox` / `send_reply` (Comet B2 5-6). TODO.

## Run
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
# config.json already filled (supabase + worker_secret + app_url)
python worker.py
```
Set `"headless": false` in `config.json` to watch it / do a first manual login
when an account hits a captcha (status → `needs_login`).

## Conventions
- Keep all OpenRent selectors inside the 5 `openrent_*.py` modules (one place to
  fix when OpenRent changes its HTML). Centralise; never scatter selectors.
- Syntax-check after edits: `python -m py_compile *.py`.
- Conservative pacing is the anti-ban strategy — never remove gaps/jitter/limits.
