"""OpenRent outreach worker — the always-on engine.

Real logic: scheduling, account rotation, blacklist, daily limits, active
hours, reply orchestration, activity logging, countdown (next_run_at). The five
browser actions (login / scrape / enquiry / read-inbox / send-reply) are STUBS
in the openrent_*.py modules — fill them from the Comet DOM map, then this runs
end-to-end with no other changes.

Run:  python worker.py     (reads config.json next to this file)
"""
from __future__ import annotations
import json
import os
import re
import time
import random
import datetime as dt
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

import browser_util
import flashproxy
import llm
import openrent_login
import openrent_signup
import openrent_listing
import openrent_enquiry
import openrent_inbox
from db import DB, now_iso, landlord_key

# Surname pool for the "Maria" persona — emails become m.<surname>@<domain>.
# Common, unremarkable UK surnames; one account per surname per domain.
PERSONA_SURNAMES = [
    "smith", "white", "jones", "taylor", "brown", "wilson", "evans",
    "thomas", "roberts", "walker", "wright", "hughes", "green", "hall",
    "wood", "clarke", "harris", "lewis", "young", "king",
]
# A reasonable default password for created accounts (mixed-case + digits +
# symbol to satisfy typical strength rules). Stored per-account in secrets.
DEFAULT_ACCOUNT_PASSWORD = "Maria!Lets2026"

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(HERE, "data", "state.json")
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def load_config() -> dict:
    with open(os.path.join(HERE, "config.json")) as f:
        return json.load(f)


def load_state() -> dict:
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {"fired": []}


def save_state(state: dict):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w") as f:
        json.dump(state, f)


# ── time helpers (Europe/London) ─────────────────────────────────────────────
def london_now(cfg) -> dt.datetime:
    return dt.datetime.now(ZoneInfo(cfg.get("timezone", "Europe/London")))


def within_active(acc: dict, cfg) -> bool:
    n = london_now(cfg)
    if DOW[n.weekday()] not in (acc.get("active_days") or []):
        return False
    hm = n.strftime("%H:%M")
    return (acc.get("active_hours_start") or "00:00") <= hm <= (acc.get("active_hours_end") or "23:59")


def _default_active_window(cfg) -> bool:
    """Conservative UK active window for first-run account creation when no
    accounts exist yet to read active_days/hours from: Mon-Sat, 09:30-17:00."""
    n = london_now(cfg)
    if DOW[n.weekday()] == "Sun":
        return False
    return "09:30" <= n.strftime("%H:%M") <= "17:00"


def parse_iso(s):
    """Tolerant ISO parser. Supabase timestamptz can come back with a 'Z', a
    bare/odd-length fractional second, or already as a datetime — Python 3.9's
    fromisoformat is strict, so normalise first. Always returns tz-aware UTC."""
    if not s:
        return None
    if isinstance(s, dt.datetime):
        return s if s.tzinfo else s.replace(tzinfo=dt.timezone.utc)
    txt = str(s).strip().replace("Z", "+00:00")
    # force fractional seconds to exactly 6 digits (3.9 requires 3 or 6)
    txt = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6], txt)
    try:
        d = dt.datetime.fromisoformat(txt)
        return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None


def due(iso) -> bool:
    """True if the (next_run_at) time has passed, or is missing/unparseable."""
    d = parse_iso(iso)
    return d is None or d <= dt.datetime.now(dt.timezone.utc)


def _short(e, limit=140) -> str:
    """First line of an error, trimmed — Playwright timeouts carry a huge multi-
    line 'Call log' that floods the activity feed otherwise."""
    s = str(e).strip().splitlines()[0] if str(e).strip() else str(e)
    return (s[:limit] + "…") if len(s) > limit else s


# ── browser sessions: one logged-in context per account ──────────────────────
class Sessions:
    def __init__(self, pw, cfg, db: DB):
        self.pw = pw
        self.cfg = cfg
        self.db = db
        self.ctx: dict[str, dict] = {}
        # Consecutive browser-op failures per account. Drives self-healing: a
        # transient blip is ignored, but a wedged session gets rebuilt instead of
        # being reused (timing out) forever.
        self.fail_counts: dict[str, int] = {}
        self.state_dir = os.path.join(HERE, "data", "sessions")
        os.makedirs(self.state_dir, exist_ok=True)

    def _state(self, acc):
        return os.path.join(self.state_dir, f"{acc['id']}.json")

    def page_for(self, acc):
        if acc["id"] in self.ctx:
            return self.ctx[acc["id"]]["page"]
        # Use the account's own proxy if it has one, otherwise fall back to the
        # shared default_proxy from config — so an account never browses without a
        # proxy (a bare IP gets the account banned). Sticky session is keyed by
        # account id either way, so each account keeps its own stable IP.
        proxy = flashproxy.parse_proxy(acc.get("proxy") or self.cfg.get("default_proxy"), sticky_id=acc["id"])
        browser = self.pw.chromium.launch(headless=self.cfg.get("headless", True), proxy=proxy)
        state = self._state(acc)
        context = browser.new_context(storage_state=state) if os.path.exists(state) else browser.new_context()
        page = context.new_page()
        if not os.path.exists(state):
            try:
                ok = openrent_login.login(page, acc.get("email"), acc.get("password"))
            except openrent_login.NeedsManualLogin as e:
                self.db.update_account(acc["id"], {"status": "needs_login", "last_error": str(e), "session_valid": False})
                self.db.log(acc["business_id"], "error", f"{acc['label']}: manual login needed — {e}", level="warn", account_id=acc["id"])
                browser.close()
                raise
            except Exception as e:  # noqa: BLE001
                self.db.update_account(acc["id"], {"status": "error", "last_error": str(e), "session_valid": False})
                self.db.log(acc["business_id"], "error", f"{acc['label']}: login failed — {e}", level="error", account_id=acc["id"])
                browser.close()
                raise
            if ok:
                context.storage_state(path=state)
                self.db.update_account(acc["id"], {"status": "live", "session_valid": True, "last_error": None})
        self.ctx[acc["id"]] = {"browser": browser, "context": context, "page": page}
        return page

    def fresh_proxied_browser(self, proxy_base, sticky_id):
        """A brand-new (logged-out) browser behind a sticky proxy keyed by
        sticky_id. Used by account creation + email confirmation — the account
        isn't logged in yet, so we deliberately bypass page_for's login path.
        Caller MUST close the returned browser. Returns (browser, page)."""
        proxy = flashproxy.parse_proxy(proxy_base, sticky_id=sticky_id)
        browser = self.pw.chromium.launch(headless=self.cfg.get("headless", True), proxy=proxy)
        context = browser.new_context()
        page = context.new_page()
        return browser, page

    def persist_session(self, acc):
        """After confirming/login, save storage_state so future runs skip login."""
        path = self._state(acc)
        if acc["id"] in self.ctx:
            try:
                self.ctx[acc["id"]]["context"].storage_state(path=path)
            except Exception:
                pass

    def close(self):
        for v in self.ctx.values():
            try:
                v["browser"].close()
            except Exception:
                pass
        self.ctx = {}

    # ── self-healing ─────────────────────────────────────────────────────────
    def note_failure(self, acc_id) -> int:
        """Record a browser-op failure for an account; returns the new run of
        consecutive failures."""
        self.fail_counts[acc_id] = self.fail_counts.get(acc_id, 0) + 1
        return self.fail_counts[acc_id]

    def note_success(self, acc_id):
        """A working op clears the failure run (and any 'last_error' we surfaced)."""
        if self.fail_counts.pop(acc_id, None):
            try:
                self.db.update_account(acc_id, {"last_error": None})
            except Exception:
                pass

    def recycle(self, acc_id):
        """Tear down a wedged browser context so the NEXT page_for rebuilds it
        with a fresh proxy connection (cookies preserved via saved storage_state).
        This is what stops one stuck tab from timing out forever."""
        v = self.ctx.pop(acc_id, None)
        if v:
            try:
                v["browser"].close()
            except Exception:
                pass

    def reset(self, acc):
        """Harder heal: recycle AND drop the saved session so the rebuild does a
        full fresh login — recovers an expired/broken OpenRent session."""
        self.recycle(acc["id"])
        try:
            p = self._state(acc)
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass

    def heal(self, acc) -> str:
        """Apply graduated self-healing from this account's consecutive-failure
        count. Returns the action taken ('none' | 'recycle' | 'reset')."""
        n = self.fail_counts.get(acc["id"], 0)
        action = browser_util.heal_action(n)
        if action == "recycle":
            self.recycle(acc["id"])
            self.db.log(acc["business_id"], "self-heal",
                        f"{acc.get('label')}: rebuilding browser session after {n} failures",
                        level="warn", account_id=acc["id"])
        elif action == "reset":
            self.reset(acc)
            self.db.update_account(acc["id"], {"session_valid": False,
                                               "last_error": "auto-recovering session (proxy/login)"})
            self.db.log(acc["business_id"], "self-heal",
                        f"{acc.get('label')}: re-login + fresh session after {n} failures",
                        level="warn", account_id=acc["id"])
        return action


# ── engine ───────────────────────────────────────────────────────────────────
def daily_reset(db: DB, acc, today: str):
    if acc.get("day_anchor") != today:
        db.update_account(acc["id"], {"messages_sent_today": 0, "day_anchor": today})
        acc["messages_sent_today"] = 0
        acc["day_anchor"] = today


def maybe_scrape(db: DB, sessions: Sessions, cfg, settings, accounts, state):
    """Autopilot: re-scrape each business's source URLs every
    `rescrape_every_min` minutes, but only while at least one of its accounts is
    within active days/hours. Keeps pulling fresh 'available now' listings; the
    per-listing dedup (target_exists) makes re-scraping safe."""
    every = int(settings.get("rescrape_every_min", 30))
    last = state.get("last_scrape", {})
    now = dt.datetime.now(dt.timezone.utc)
    biz_ids = sorted({a["business_id"] for a in accounts})
    for biz in biz_ids:
        biz_accounts = [a for a in accounts if a["business_id"] == biz]
        if not any(within_active(a, cfg) for a in biz_accounts):
            continue
        prev = parse_iso(last.get(biz))
        if prev and (now - prev).total_seconds() < every * 60:
            continue
        last[biz] = now_iso()
        state["last_scrape"] = last
        save_state(state)
        scrape_business(db, sessions, cfg, settings, biz, accounts)


def scrape_business(db: DB, sessions: Sessions, cfg, settings, business_id, accounts):
    urls = db.source_urls(business_id)
    biz_accounts = [a for a in accounts if a["business_id"] == business_id and a.get("status") not in ("disabled",)]
    if not urls or not biz_accounts:
        return
    db.log(business_id, "scrape", f"Scan: {len(urls)} search URLs across {len(biz_accounts)} accounts")
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=int(settings.get("only_listings_newer_than_days", 3)))
    found = new = 0
    for i, u in enumerate(urls):
        acc = biz_accounts[i % len(biz_accounts)]
        try:
            page = sessions.page_for(acc)
            listings = openrent_listing.scrape_search(page, u["url"])
        except Exception as e:  # noqa: BLE001
            n = sessions.note_failure(acc["id"])
            sessions.heal(acc)
            db.log(business_id, "error", f"Scrape failed (×{n}): {_short(e)}", level="warn", account_id=acc["id"])
            continue
        sessions.note_success(acc["id"])
        for lst in listings:
            found += 1
            ext = str(lst.get("external_listing_id") or "").strip()
            if not ext or db.target_exists(business_id, ext):
                continue  # not new (already seen)
            posted = parse_iso(lst.get("posted_at"))
            if posted and posted < cutoff:
                continue  # too old
            key = landlord_key(lst.get("landlord_name"))
            blacklisted = db.blacklist_active(business_id, key)
            db.upsert_target({
                "business_id": business_id,
                "external_listing_id": ext,
                "listing_url": lst.get("listing_url"),
                "source_url_id": u["id"],
                "status": "blacklisted" if blacklisted else "ready",
                "landlord_name": lst.get("landlord_name"),
                "landlord_key": key,
                "title": lst.get("title"),
                "price_text": lst.get("price_text"),
                "postcode": lst.get("postcode"),
                "posted_at": lst.get("posted_at"),
            })
            if not blacklisted:
                new += 1
    db.log(business_id, "scrape", f"Scan done: {found} seen, {new} new ready to contact")


# ── Phase 2: persona account creation ("Maria" → m.<surname>@<domain>) ───────
def _persona_email(first_name, surname, domain):
    """m.smith@<domain> from persona first name + surname + catch-all domain."""
    initial = (first_name or "Maria").strip().lower()[:1] or "m"
    return f"{initial}.{surname}@{domain}"


def _next_surname(db: DB, business_id, domain_id, domain, first_name):
    """Pick the next surname whose persona email isn't already taken on this
    domain. Returns (surname, email) or (None, None) if the pool is exhausted."""
    for surname in PERSONA_SURNAMES:
        email = _persona_email(first_name, surname, domain)
        if not db.account_email_exists(business_id, email):
            return surname, email
    return None, None


def maybe_create_accounts(db: DB, sessions: Sessions, cfg, settings, accounts, state):
    """Auto-create persona OpenRent accounts: at most once/day per domain, up to
    accounts_per_domain_per_day, only while active hours apply and under a global
    daily cap. Mirrors maybe_scrape's fired-key / state.json gating exactly:
    a per-(domain, YYYY-MM-DD) key in state['accounts_fired'] ensures we attempt
    a given domain at most once per calendar day."""
    if not settings.get("account_creation_enabled"):
        return
    per_domain = int(settings.get("accounts_per_domain_per_day", 2))
    if per_domain <= 0:
        return
    first_name = (settings.get("persona_first_name") or "Maria").strip()
    today = london_now(cfg).strftime("%Y-%m-%d")
    today_start = dt.datetime.now(dt.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    fired = state.get("accounts_fired", {})
    # Global safety cap per run: never create more than per_domain in one tick.
    global_cap = per_domain
    created_this_run = 0

    biz_ids = sorted({a["business_id"] for a in accounts}) or [cfg.get("business_id")]
    biz_ids = [b for b in biz_ids if b]
    for business_id in biz_ids:
        biz_accounts = [a for a in accounts if a["business_id"] == business_id]
        # Active-hours gate: if accounts already exist, require at least one to be
        # within its active window. With zero accounts (first-run bootstrap), use
        # a conservative default UK window (Mon-Sat 09:30-17:00) so we never sign
        # up at 3am.
        if biz_accounts:
            if not any(within_active(a, cfg) for a in biz_accounts):
                continue
        elif not _default_active_window(cfg):
            continue
        for domain in db.active_domains(business_id):
            if created_this_run >= global_cap:
                return
            key = f"{domain['id']}:{today}"
            if fired.get(key):
                continue  # already attempted this domain today
            already = db.auto_accounts_created_today(business_id, domain["id"], today_start)
            to_make = max(0, per_domain - already)
            if to_make <= 0:
                fired[key] = now_iso(); state["accounts_fired"] = fired; save_state(state)
                continue
            # Mark fired up-front so a crash mid-loop doesn't re-attempt today.
            fired[key] = now_iso(); state["accounts_fired"] = fired; save_state(state)
            for _ in range(to_make):
                if created_this_run >= global_cap:
                    return
                _create_one_account(db, sessions, cfg, settings, business_id, domain, first_name)
                created_this_run += 1
                # Small jitter between sign-ups (anti-pattern detection).
                time.sleep(random.randint(3, 9))


def _create_one_account(db: DB, sessions: Sessions, cfg, settings, business_id, domain, first_name):
    domain_name = domain["domain"]
    surname, email = _next_surname(db, business_id, domain["id"], domain_name, first_name)
    if not email:
        db.log(business_id, "error", f"Account creation: surname pool exhausted for {domain_name}", level="warn")
        return
    persona = f"{first_name} {surname.capitalize()}"
    password = DEFAULT_ACCOUNT_PASSWORD
    proxy_base = cfg.get("default_proxy")  # shared FlashProxy base; sticky id added per account
    if not proxy_base:
        db.log(business_id, "error", "Account creation: no default_proxy in config.json", level="warn")
        return
    label = persona
    acc_id = db.create_account(business_id, domain["id"], label, email, password,
                               proxy_base, persona)
    if not acc_id:
        return  # email already existed (race) — skip
    browser = None
    try:
        browser, page = sessions.fresh_proxied_browser(proxy_base, acc_id)
        openrent_signup.signup(page, email, password)
        # Best-effort display name (cosmetic; DOM not fully mapped — see signup module).
        try:
            openrent_signup.set_profile_name(page, persona)
        except Exception:
            pass
        db.log(business_id, "account-created",
               f"Signed up {email} ({persona}) — awaiting email confirmation", account_id=acc_id)
    except openrent_signup.SignupBlocked as e:  # noqa: BLE001
        db.update_account(acc_id, {"status": "error", "last_error": str(e)})
        db.log(business_id, "error", f"Signup blocked for {email}: {e}", level="warn", account_id=acc_id)
    except Exception as e:  # noqa: BLE001
        db.update_account(acc_id, {"status": "error", "last_error": str(e)})
        db.log(business_id, "error", f"Signup failed for {email}: {e}", level="error", account_id=acc_id)
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass


def process_account_requests(db: DB, sessions: Sessions, cfg, settings):
    """Drain on-demand "Create N now" requests fired from the Emails tab. Runs
    REGARDLESS of account_creation_enabled — these are explicit user actions — but
    still respects active hours and a per-tick safety cap so a big request can't
    create dozens in one go. Each request creates up to (requested - created)
    accounts; we bump `created` after each and mark the request 'done' once it's
    fully drained. A request with domain_id=null spreads round-robin over the
    business's active catch-all domains."""
    requests = db.pending_account_requests()
    if not requests:
        return
    first_name = (settings.get("persona_first_name") or "Maria").strip()
    # Per-tick safety cap across ALL requests, mirroring maybe_create_accounts.
    per_tick_cap = 3
    created_this_tick = 0

    for req in requests:
        if created_this_tick >= per_tick_cap:
            return
        business_id = req["business_id"]
        # Active-hours gate (same as auto-creation): if accounts exist, require one
        # within its window; otherwise fall back to the conservative UK window.
        biz_accounts = [a for a in db.accounts() if a["business_id"] == business_id]
        if biz_accounts:
            if not any(within_active(a, cfg) for a in biz_accounts):
                continue
        elif not _default_active_window(cfg):
            continue

        active = db.active_domains(business_id)
        if not active:
            db.log(business_id, "error",
                   "Create-now request skipped: no active catch-all domains", level="warn")
            continue
        # Target domains: the chosen one, or all active (round-robin).
        if req.get("domain_id"):
            domains = [d for d in active if d["id"] == req["domain_id"]]
            if not domains:
                db.log(business_id, "error",
                       "Create-now request skipped: chosen domain not active", level="warn")
                continue
        else:
            domains = active

        remaining = max(0, int(req.get("requested", 0)) - int(req.get("created", 0)))
        made = 0
        di = 0
        for _ in range(remaining):
            if created_this_tick >= per_tick_cap:
                break
            domain = domains[di % len(domains)]
            di += 1
            _create_one_account(db, sessions, cfg, settings, business_id, domain, first_name)
            db.bump_request_created(req["id"], 1)
            req["created"] = int(req.get("created", 0)) + 1
            made += 1
            created_this_tick += 1
            time.sleep(random.randint(3, 9))  # anti-pattern jitter

        if int(req.get("created", 0)) >= int(req.get("requested", 0)):
            db.mark_request_done(req["id"])
            db.log(business_id, "account-created",
                   f"Create-now request done: {req.get('requested')} account(s) created", account_id=None)


# Match a confirmation/verification link in the OpenRent email (text or html).
_CONFIRM_RE = re.compile(
    r"https?://(?:www\.)?openrent\.co\.uk/[^\s\"'<>]*"
    r"(?:confirm|verify|activate|email)[^\s\"'<>]*",
    re.IGNORECASE,
)


def _extract_confirm_url(*texts) -> str | None:
    for t in texts:
        if not t:
            continue
        m = _CONFIRM_RE.search(t)
        if m:
            return m.group(0).replace("&amp;", "&")
    return None


def confirm_pending_accounts(db: DB, sessions: Sessions, cfg):
    """For each persona account in 'pending_confirm', look for the OpenRent
    confirmation email in the catch-all inbox (addressed to its persona email),
    extract the confirm URL, open it through the SAME sticky proxy, then flip the
    account to 'live'."""
    for acc in db.pending_confirm_accounts():
        business_id = acc["business_id"]
        email = acc.get("email")
        emails = db.received_emails_for(business_id, email, since_iso=acc.get("created_at"))
        # Prefer an OpenRent confirmation email with a link.
        confirm_url = None
        src_email = None
        for em in emails:
            url = _extract_confirm_url(em.get("body"), em.get("html"), em.get("subject"))
            if url:
                confirm_url, src_email = url, em
                break
        if not confirm_url:
            continue  # not arrived yet — try again next tick
        proxy_base = acc.get("proxy") or cfg.get("default_proxy")
        browser = None
        try:
            browser, page = sessions.fresh_proxied_browser(proxy_base, acc["id"])
            page.goto(confirm_url, wait_until="domcontentloaded")
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
            db.update_account(acc["id"], {
                "status": "live", "session_valid": False,
                "confirmed_at": now_iso(), "last_error": None,
            })
            if src_email:
                db.mark_email_used(src_email["id"], email)
            db.log(business_id, "account-confirmed",
                   f"Confirmed {email} — account is live", account_id=acc["id"])
        except Exception as e:  # noqa: BLE001
            db.log(business_id, "error", f"Confirm failed for {email}: {e}", level="warn", account_id=acc["id"])
        finally:
            if browser:
                try:
                    browser.close()
                except Exception:
                    pass


def run_rotation(db: DB, sessions: Sessions, cfg, settings, accounts):
    biz_ids = sorted({a["business_id"] for a in accounts})
    for business_id in biz_ids:
        targets = db.ready_targets(business_id)
        if not targets:
            continue
        elig = [a for a in accounts if a["business_id"] == business_id
                and a.get("status") not in ("disabled", "error", "needs_login")
                and within_active(a, cfg)
                and a.get("messages_sent_today", 0) < a.get("daily_message_limit", 0)
                and due(a.get("next_run_at"))]
        if not elig:
            continue
        # Fair rotation: the least-recently-used account goes first each tick, so
        # an earlier-window / lower-order account can't keep draining the ready
        # pool before the others ever get a turn. Never-run accounts (last_run_at
        # None) sort first; rotation_order is only a tie-breaker.
        elig.sort(key=lambda a: (a.get("last_run_at") or "", a.get("rotation_order", 0)))
        max_sends = int(settings.get("max_sends_per_run", 2))
        sent = 0
        ti = 0
        for acc in elig:
            if sent >= max_sends or ti >= len(targets):
                break
            t = targets[ti]; ti += 1
            if db.blacklist_active(business_id, t.get("landlord_key")):
                db.set_target(t["id"], {"status": "blacklisted"})
                continue
            if not db.claim_target(t["id"]):
                continue
            try:
                page = sessions.page_for(acc)
                msg = llm.draft_outreach(cfg, {
                    "title": t.get("title"), "price_text": t.get("price_text"),
                    "postcode": t.get("postcode"), "landlord_name": t.get("landlord_name"),
                    "listing_url": t.get("listing_url"),
                })
                if not msg:
                    db.set_target(t["id"], {"status": "ready"})
                    continue
                res = openrent_enquiry.send_enquiry(
                    page, t.get("listing_url"), msg,
                    landlord_blacklisted=lambda name: db.blacklist_active(business_id, landlord_key(name)),
                )
            except Exception as e:  # noqa: BLE001
                sessions.note_failure(acc["id"])
                sessions.heal(acc)
                db.set_target(t["id"], {"status": "ready", "last_error": _short(e)})
                db.log(business_id, "error", f"Enquiry failed: {_short(e)}", level="warn", account_id=acc["id"])
                continue
            sessions.note_success(acc["id"])
            # landlord name is captured on the listing page (the search card omits it)
            name = res.get("landlord_name") or t.get("landlord_name")
            key = landlord_key(name) if name else (t.get("landlord_key") or "")
            if res.get("skipped_blacklist"):
                db.set_target(t["id"], {"status": "blacklisted", "landlord_name": name, "landlord_key": key})
                db.log(business_id, "skip-blacklist", f"Skipped {name or 'landlord'} (contacted recently)", account_id=acc["id"])
                continue
            if not res.get("ok"):
                db.set_target(t["id"], {"status": "error", "last_error": res.get("error"), "landlord_name": name, "landlord_key": key})
                continue
            # success: contact + conversation + message, blacklist, counters
            contact_id = db.get_or_create_contact(business_id, name or "Landlord")
            conv_id = db.create_conversation(business_id, contact_id, acc["id"], res.get("external_thread_id"), msg)
            db.add_message(conv_id, "outbound", "ai", msg, status="sent", meta={"via": "openrent_pitch"})
            if key:
                db.add_blacklist(business_id, key, name, int(settings.get("blacklist_days", 30)), acc["id"], t["id"])
            db.set_target(t["id"], {"status": "contacted", "contacted_at": now_iso(), "contacted_by_account": acc["id"], "conversation_id": conv_id, "landlord_name": name, "landlord_key": key})
            gap = int(settings.get("gap_between_sends_min", 4)) + random.randint(0, int(settings.get("gap_jitter_min", 3)))
            nxt = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=gap)).isoformat()
            db.update_account(acc["id"], {"messages_sent_today": acc.get("messages_sent_today", 0) + 1, "next_run_at": nxt, "last_run_at": now_iso(), "status": "live"})
            acc["messages_sent_today"] = acc.get("messages_sent_today", 0) + 1
            sent += 1
            db.log(business_id, "pitch-sent", f"Messaged {t.get('landlord_name') or 'landlord'} — {t.get('title') or t.get('listing_url')}", account_id=acc["id"])


def poll_replies(db: DB, sessions: Sessions, cfg, accounts):
    for acc in accounts:
        if acc.get("status") in ("disabled", "error", "needs_login"):
            continue
        try:
            page = sessions.page_for(acc)
            threads = openrent_inbox.read_inbox(page)
        except Exception as e:  # noqa: BLE001
            n = sessions.note_failure(acc["id"])
            sessions.heal(acc)  # rebuild a wedged session instead of reusing it
            db.log(acc["business_id"], "error", f"Inbox read failed (×{n}): {_short(e)}", level="warn", account_id=acc["id"])
            continue
        sessions.note_success(acc["id"])
        for th in threads:
            conv = db.find_conversation(acc["business_id"], th.get("external_thread_id"))
            if not conv:
                continue  # only track threads we started (the enquiry created the conversation)
            for m in th.get("messages", []):
                if m.get("from") != "them":
                    continue
                if db.message_exists(conv["id"], m.get("external_id")):
                    continue
                db.add_message(conv["id"], "inbound", "contact", m.get("text"), status="received", external_id=m.get("external_id"), bump_unread=True, meta={"via": "openrent"})
                db.log(acc["business_id"], "reply-in", f"New reply from {th.get('landlord_name') or 'landlord'}", account_id=acc["id"])


def process_ai_replies(db: DB, cfg, settings, accounts):
    """For OpenRent conversations whose last message is an unanswered inbound and
    AI is on: after reply_delay_seconds, draft a reply and queue it (auto-send)
    or save it as a draft for approval."""
    biz_ids = sorted({a["business_id"] for a in accounts})
    delay = int(settings.get("reply_delay_seconds", 60))
    for business_id in biz_ids:
        convs = db.sb.table("conversations").select("id,ai_handling").eq("business_id", business_id).eq("channel", "openrent").eq("ai_handling", True).execute().data or []
        for c in convs:
            msgs = db.thread_messages(c["id"])
            if not msgs:
                continue
            last = msgs[-1]
            if last.get("direction") != "inbound":
                continue  # already handled / we spoke last
            ts = parse_iso(last.get("created_at"))
            if ts and (dt.datetime.now(dt.timezone.utc) - ts).total_seconds() < delay:
                continue
            history = [{"from": "us" if m["direction"] == "outbound" else "them", "text": m.get("body") or ""} for m in msgs]
            reply = llm.draft_reply(cfg, history)
            if not reply:
                continue
            status = "queued" if settings.get("reply_auto_send") else "draft"
            db.add_message(c["id"], "outbound", "ai", reply, status=status, meta={"via": "openrent_ai_reply"})


def send_queued(db: DB, sessions: Sessions, cfg, accounts):
    acc_by_id = {a["id"]: a for a in accounts}
    for m in db.queued_outbound():
        conv = m["conversation"]
        acc = acc_by_id.get(conv.get("openrent_account_id"))
        if not acc:
            continue
        if not db.claim_message(m["id"]):
            continue
        try:
            page = sessions.page_for(acc)
            res = openrent_inbox.send_reply(page, conv.get("external_thread_id"), m.get("body"))
        except Exception as e:  # noqa: BLE001
            n = sessions.note_failure(acc["id"])
            sessions.heal(acc)
            db.mark_message(m["id"], "failed")
            db.log(conv["business_id"], "error", f"Reply send failed (×{n}): {_short(e)}", level="warn", account_id=acc["id"])
            continue
        sessions.note_success(acc["id"])
        db.mark_message(m["id"], "sent" if res.get("ok") else "failed")
        if res.get("ok"):
            db.log(conv["business_id"], "ai-reply", "Reply sent on OpenRent", account_id=acc["id"])


def tick(db: DB, sessions: Sessions, cfg, state):
    settings = db.get_settings()
    if not settings.get("enabled"):
        return
    accounts = db.accounts()
    # Phase 2 runs even with zero accounts (it bootstraps the first ones) and
    # before the early-return below, so account creation/confirmation isn't
    # blocked by having no accounts yet.
    maybe_create_accounts(db, sessions, cfg, settings, accounts, state)
    # On-demand "Create N now" requests run regardless of the daily toggle.
    process_account_requests(db, sessions, cfg, settings)
    confirm_pending_accounts(db, sessions, cfg)
    if not accounts:
        return
    today = london_now(cfg).strftime("%Y-%m-%d")
    for a in accounts:
        daily_reset(db, a, today)
    maybe_scrape(db, sessions, cfg, settings, accounts, state)
    run_rotation(db, sessions, cfg, settings, accounts)
    poll_replies(db, sessions, cfg, accounts)
    process_ai_replies(db, cfg, settings, accounts)
    send_queued(db, sessions, cfg, accounts)


def main():
    cfg = load_config()
    db = DB(cfg)
    state = load_state()
    interval = int(cfg.get("tick_seconds", 20))
    print(f"[worker] OpenRent worker started (tick {interval}s)")
    with sync_playwright() as pw:
        sessions = Sessions(pw, cfg, db)
        try:
            while True:
                try:
                    tick(db, sessions, cfg, state)
                except Exception as e:  # noqa: BLE001
                    print(f"[worker] tick error: {e}")
                time.sleep(interval)
        finally:
            sessions.close()


if __name__ == "__main__":
    main()
