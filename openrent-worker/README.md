# OpenRent outreach worker

Always-on robot that logs into OpenRent accounts (each via its own FlashProxy
IP), scrapes pasted search URLs for **new** listings, AI-messages landlords in
rotation, and syncs replies into the Unico app. Reads/writes Supabase directly.

This worker is the "brain". The five browser actions are **stubs** to be filled
from the Comet DOM map (prompts B1/B2):

| File | What to fill | Comet |
|---|---|---|
| `openrent_login.py` | login form, captcha/2FA detection | B1 |
| `openrent_listing.py` | scrape search results + a listing | B2 (1-2) |
| `openrent_enquiry.py` | enquiry form + send | B2 (3-4) |
| `openrent_inbox.py` | read inbox + send reply | B2 (5-6) |
| `flashproxy.py` | sticky-session username suffix | B3 |

Everything else (scheduling, rotation, blacklist, daily limits, active hours,
reply orchestration, logging, countdowns) is already wired.

## Setup (Mac — Step 1)

```bash
cd ~/Whats/Poppy/openrent-worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
cp config.example.json config.json     # then fill in the values
python worker.py
```

`config.json` needs: `supabase_url`, `supabase_service_role_key` (Unico project
`ceoizvfxjpzelmzwmnlt`), `app_url`, `worker_secret` (= `OPENRENT_WORKER_SECRET`
set on Vercel). Per-account OpenRent login + FlashProxy proxy are added in the
Unico UI (OpenRent → Control → Accounts) and stored in Supabase.

Set `"headless": false` to watch it / do a manual login when an account hits a
captcha (status → `needs_login`).

## Server (Step 2 — once verified on the Mac)

Run the same folder on a small always-on Linux box in Docker:

```dockerfile
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["python", "worker.py"]
```

`docker run -d --restart always -v $PWD/data:/app/data openrent-worker`
(mount `data/` so saved logins + scrape state survive restarts).
