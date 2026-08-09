# HANDOFF — from the Scraper HQ to Poppy

*Written 2026-07-27. Purpose: tell the Poppy project what the scraper folder
(`/Users/hugo/Whats/scraper`) is, what it produces, and how Poppy plugs into it.*

**One line:** the scraper HQ is Hugo's **lead-generation machine**. It scrapes
plumber/roofer businesses and enriches them with owner names. Poppy is the **One Call
delivery app** that acts on those leads. **The connection point is the exported CSV
lead lists.**

> 🔒 **No raw secrets in this file — on purpose.** Every password/key lives in ONE
> place: the scraper's memory vault at
> `~/.claude/projects/-Users-hugo-Whats-scraper/memory/`. This file only says *what
> exists* and *where the secret is*, so credentials aren't scattered across folders.

---

## 1. What the scraper HQ produces (what Poppy consumes)

- **Lead lists as CSV files**, in `scraper/exports/`:
  - `uk_plumbers_sheet_*.csv`, `uk_plumbers_under30_reviews.csv` — UK plumbers with
    mobile number + owner name (feeds the One Call cold-call script).
  - `usa_*.csv` — USA plumbers + roofers.
- **Master database:** `scraper/data/scraper.db` (~40k leads, UK + USA). Production —
  never wiped.
- These CSVs are the **handoff artifact**: Poppy imports them as the contact list to
  deliver against.

## 2. Systems in the scraper HQ

| System | What it does | Status |
|---|---|---|
| Google Maps Lead Scraper (engine) | scrapes business listings | core engine |
| UK Plumbers campaign | UK plumbers ≤65 reviews + owner names (Companies House) | live (proxy needs top-up) |
| USA Leads | 10k plumbers + 10k roofers | **live — do not disturb** |
| Housing Ads scraper (Facebook) | ~20k US housing-ad URLs | finished |
| `one call/` | Skool course knowledge base (the sales model) | reference docs |
| `service-company-creator/` | industry-target research | reference docs |

Full map: `scraper/CLAUDE.md`. Live job status: `scraper/WORKLOG.md`.

## 3. Where it runs — margarita VPS
- Hostinger VPS, IP `187.77.100.86`, code at `/root/scraper` (Python 3.12).
- Login alias `ssh margarita-server`. **Credentials → memory `margarita-vps-and-flashproxy`.**
- Jobs run here, never on the Mac. USA scrapers are always-on — don't disturb.

## 4. Accesses (values live in the vault, not here)

| Access | What it's for | Secret location |
|---|---|---|
| margarita VPS (ssh/root) | run all scrapers | memory → `margarita-vps-and-flashproxy` |
| FlashProxy (rotating GB) | UK scraping ⚠️ out of data since 2026-07-21 | memory → `margarita-vps-and-flashproxy` |
| iProyal (local proxy) | local Google Maps runs | not in vault |
| Companies House API | UK owner/director + address lookup | memory → `companies-house-api-key` |
| UK dashboard (`:8090`) | view UK progress in browser | `scraper/CLAUDE.md` |
| Kimi-in-Claude-Code (`claude-kimi`) | run Claude Code on Kimi K3 (Mac + VPS) | memory → `kimi-claude-code` |
| Skool logins | course capture in `one call/` | memory → `skool-credentials` |

Full memory index: `~/.claude/projects/-Users-hugo-Whats-scraper/memory/MEMORY.md`.

## 5. How Poppy connects to this
1. Scraper produces/refreshes a CSV in `scraper/exports/`.
2. Poppy imports that CSV as its delivery contact list.
3. (Optional future step) automate the pull from `scraper.db` on the VPS instead of
   hand-passing CSVs — not built yet.

**Poppy does NOT need the scraper's server password or proxy keys** to operate — it
only needs the CSV outputs. Keep those accesses in the scraper vault.
