# Google Maps Lead Scraper (local · Windows)

A single-machine Flask + Playwright scraper for Google Maps business listings.
Saves to a local SQLite DB (`data/scraper.db`), exports CSVs to `exports/`.
No Google API, no SerpAPI, no cloud.

## Install

```cmd
cd scraper
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

## Run

```cmd
python app.py
```

Open <http://localhost:5000>.

## Usage

1. Paste keywords (one per line) and locations (one per line).
2. (Optional) Paste your iProyal residential creds, click **Test proxy** —
   should show your egress IP + country.
3. Tweak settings (max per query, delays, headless, full-details).
4. Click **Start**. Watch live metrics + the streaming results table.
5. Use **Pause** to halt mid-job (e.g. solve a CAPTCHA in the visible browser),
   then **Pause** again to resume. **Stop** ends the session.
6. Right-hand pane lets you download per-session CSVs or export everything.

### iProyal credential format

The app builds the proxy URL as `http://USER:PASS@HOST:PORT`. To get a sticky
residential session, the app appends `_session-<random>` to your username
automatically (the iProyal default sticky-session format). It rotates that
token every N requests (default 25), and on 429 / 403 / `/sorry/` / CAPTCHA.

If you already include `_session-...` in the username field, the app leaves it
alone.

### Where things live

- DB: `scraper/data/scraper.db` (auto-created, WAL-mode SQLite)
- CSVs: `scraper/exports/leads_session_<id>_<YYYYMMDD-HHMM>.csv` and
  `scraper/exports/leads_all_<YYYYMMDD-HHMM>.csv` (UTF-8 with BOM — opens
  cleanly in Excel)
- Logs: in-memory, streamed to the UI log panel

## Troubleshooting

- **CAPTCHA banner appears** — the app rotates the proxy session and retries
  once; if Google still blocks, the job pauses. Untick "headless" in settings,
  click **Start**, solve any visible CAPTCHA in the browser window, then click
  **Pause** (it's currently paused — clicking once resumes).
- **Proxy ban / 403** — try a different iProyal pool (city/country in the
  username), shorten `rotate_every` to 10, raise the delay to 4–8s.
- **Selectors broken** — Google occasionally renames classes. The card selector
  in `scraper.py` has a fallback (`a.hfpxzc, div[role='feed'] a[href*='/maps/place/']`).
  If both miss, run with `headless=False`, open devtools on the results pane,
  and update `CARD_SELECTOR` / `FEED_SELECTOR` at the top of `scraper.py`.
- **Excel mojibake on CSV** — already handled (UTF-8 with BOM). If you still
  see it, don't double-click; use Data → From Text/CSV in Excel.
- **`playwright install chromium` fails** — make sure you ran it inside the
  venv that has `playwright` installed.

## First-run cheat sheet

1. `cd scraper`
2. `python -m venv .venv && .venv\Scripts\activate`
3. `pip install -r requirements.txt`
4. `playwright install chromium`
5. `python app.py`
6. Open <http://localhost:5000>.
7. Paste iProyal host/port/user/pass, click **Test proxy** → expect `✔ <ip>`.
8. Type one keyword (e.g. `plumbers`) and one location (e.g. `Manchester, UK`).
9. Untick **headless** the first time so you can watch / solve a CAPTCHA.
10. Click **Start** → leads stream into the middle table; CSV export is on the right.
