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

import alerts
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
# Common, unremarkable UK surnames; one account per surname per domain. Keep this
# list long: a new account skips any surname already taken, so a short pool runs
# dry (and "surname pool exhausted" stops creation). Add more common surnames
# here whenever headroom gets low — never reuse one already used elsewhere.
PERSONA_SURNAMES = [
    "smith", "white", "jones", "taylor", "brown", "wilson", "evans",
    "thomas", "roberts", "walker", "wright", "hughes", "green", "hall",
    "wood", "clarke", "harris", "lewis", "young", "king",
    # second batch (added 2026-06-17) — all common UK surnames, none reused above
    "martin", "cooper", "ward", "morris", "cook", "bailey", "bell", "murphy",
    "gray", "james", "watson", "price", "kelly", "mason", "palmer", "mitchell",
    "marshall", "owen", "harrison", "robinson", "turner", "scott", "edwards",
    "hill", "moore", "allen", "parker", "carter", "phillips", "collins",
    "stewart", "morgan", "cox", "richards", "fox", "shaw", "holmes", "knight",
]
# Standard password for ALL new accounts (one fixed value, prefilled in the app
# so Hugo never types it). Stored per-account in secrets. Existing accounts keep
# whatever they were created with — changing a stored password without also
# changing it on OpenRent would break that account's login.
DEFAULT_ACCOUNT_PASSWORD = "Unico!Rent2026"

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(HERE, "data", "state.json")
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# ── Self-healing login (gentle auto re-login → human handoff) ─────────────────
# A genuinely-logged-out account re-logs-in on the FIRST attempt, so we don't need
# many tries. Repeated FAILED logins are exactly what trips OpenRent's security
# lock — so we retry few times, slowly, then STOP (for anything that actually
# submitted a bad login) and wait for a human, rather than hammering it locked.
MAX_LOGIN_ATTEMPTS = 3                        # failed attempts before we hand off
LOGIN_BACKOFF_MIN = [10, 30]                  # minutes before retry #2, #3 (gentle, not rapid)
LONG_RETRY_MIN = 360                          # slow-lane re-check (6h) — ONLY for connection blips
MAX_RECOVER_PER_TICK = 2                      # cap proactive re-logins per tick (anti-burst)
MAX_PROFILE_NAMES_PER_TICK = 2                # cap profile-name backfills per tick (anti-burst)

# ── proxy health + fallback ───────────────────────────────────────────────────
# Confirm each account's egress IP through its proxy on this cadence so Hugo sees
# live "proxy working" status, and we catch a dead proxy and fall back to the next
# credential in the pool. The IP check is a tiny ipinfo.io JSON (a few hundred
# bytes), so re-checking is cheap.
PROXY_CHECK_EVERY_MIN = 10                    # confirmed-'ok' accounts: re-confirm the IP every 10 min
PROXY_RECHECK_DOWN_MIN = 1                    # never-checked OR 'down': re-check almost every tick (fast self-heal)
MAX_PROXY_CHECKS_PER_TICK = 20                # raised from 4 so a new-account backlog clears in ONE tick (checks are cheap HTTP)

# Stop on the FIRST hit — retrying these can't help and often makes it worse:
#   banned          = permanent; bad_credentials = wrong pw will just keep failing;
#   locked          = security lock that MORE failed logins would deepen.
TERMINAL_LOGIN_KINDS = {
    openrent_login.KIND_BANNED,
    openrent_login.KIND_BAD_CREDENTIALS,
    openrent_login.KIND_LOCKED,
}
# The ONLY kind safe to keep auto-retrying forever: a connection failure never
# reached a login submission, so it can't lock the account. Everything else, once
# its few attempts are spent, STOPS and waits for a human (no perpetual hammering).
SAFE_TO_RETRY_KINDS = {openrent_login.KIND_NETWORK}
# Plain-English reason shown to Hugo for each classified failure kind.
FAILURE_REASON = {
    openrent_login.KIND_NETWORK: "couldn't reach OpenRent (proxy or site issue)",
    openrent_login.KIND_CAPTCHA: "OpenRent showed a captcha / 2-factor challenge",
    openrent_login.KIND_BAD_CREDENTIALS: "OpenRent rejected the email/password",
    openrent_login.KIND_UNCONFIRMED: "the account's email isn't confirmed yet",
    openrent_login.KIND_BANNED: "OpenRent has suspended/blocked this account",
    openrent_login.KIND_LOCKED: "OpenRent locked the account for security (usually after repeated logins)",
    openrent_login.KIND_UNKNOWN: "login didn't complete and we couldn't tell why",
}
# Rule-based diagnosis (plain English + the fix) for the kinds we already
# understand. The AI is only asked to diagnose 'unknown' failures.
RULE_DIAGNOSIS = {
    openrent_login.KIND_BANNED:
        "OpenRent appears to have suspended or blocked this account. The system will "
        "keep checking automatically in case it's temporary, but it likely won't come "
        "back — best to replace it with a fresh account on a different email/proxy.",
    openrent_login.KIND_BAD_CREDENTIALS:
        "OpenRent rejected the saved email or password. It keeps retrying on its own, "
        "but it can't succeed until the password is right — open the account and "
        "re-enter the correct OpenRent password (then 'Try now' to retry immediately).",
    openrent_login.KIND_CAPTCHA:
        "OpenRent showed a captcha / 2-factor check that a robot can't pass. The system "
        "keeps retrying automatically and this often clears on its own; if it keeps "
        "happening this account's IP may be flagged — try a different proxy or replace it.",
    openrent_login.KIND_UNCONFIRMED:
        "The account's email confirmation hasn't gone through yet. The system keeps "
        "retrying automatically; check the Emails tab for the OpenRent confirmation "
        "link — once it's confirmed the next auto-retry will log it in.",
    openrent_login.KIND_NETWORK:
        "We couldn't reach OpenRent after several tries — usually a temporary proxy or "
        "site outage. It keeps re-checking automatically every few hours; if it persists, "
        "check the FlashProxy account.",
    openrent_login.KIND_LOCKED:
        "OpenRent has temporarily locked this account for security — usually triggered by "
        "repeated failed logins. Auto-retry has STOPPED so it doesn't make the lock worse. "
        "Wait for the lock to clear (or use the unlock/reset email OpenRent sent), make sure "
        "the saved password is correct, then press Try now.",
}


class SessionUnavailable(Exception):
    """page_for could not hand back a logged-in page right now — either a login
    retry is still in its backoff window, or a login was just attempted and the
    outcome has already been recorded/logged. Callers skip the account quietly
    (no extra error log, no failure-count bump)."""


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
        # Which credential in cfg's proxy_pool every account currently browses
        # through. check_proxies advances this when the live credential dies; it's
        # persisted in the DB so logins and the health check agree across restarts.
        self.proxy_index = db.get_proxy_index()

    def _state(self, acc):
        return os.path.join(self.state_dir, f"{acc['id']}.json")

    def _active_base(self) -> str | None:
        """The pool credential every account currently uses (sticky session is
        still keyed per account, so each keeps its own IP). All accounts share one
        live credential so a single fallback moves the whole fleet at once."""
        p = flashproxy.pool(self.cfg)
        if not p:
            return self.cfg.get("default_proxy")
        return p[self.proxy_index % len(p)]

    def page_for(self, acc):
        if acc["id"] in self.ctx:
            return self.ctx[acc["id"]]["page"]
        state = self._state(acc)
        has_session = os.path.exists(state)
        # No usable session AND we're inside a login-retry backoff window → wait.
        if not has_session and self._in_login_cooldown(acc):
            raise SessionUnavailable(f"{acc.get('label')}: login retry scheduled later")

        # Every account browses through the live pool credential (never a bare IP —
        # that gets the account banned). Sticky session is keyed by account id, so
        # each account keeps its own stable IP; a fallback swap moves the whole
        # fleet to the next working credential at once.
        proxy = flashproxy.parse_proxy(self._active_base(), sticky_id=acc["id"])
        browser = self.pw.chromium.launch(headless=self.cfg.get("headless", True), proxy=proxy)
        context = browser.new_context(storage_state=state) if has_session else browser.new_context()
        page = context.new_page()

        if has_session and not self._is_unhealthy(acc):
            # DB says this session is good — trust the saved cookies (no extra
            # navigation, so a worker restart with N healthy accounts doesn't pay N
            # slow proxy round-trips up front). A session that silently died is
            # still caught by the action-failure heal path (recycle → reset → re-login).
            self.ctx[acc["id"]] = {"browser": browser, "context": context, "page": page}
            return page

        if has_session:
            # DB record says this account is BROKEN but a saved session exists —
            # validate the cookies; OpenRent silently expires sessions and reusing a
            # dead one is exactly what wedges an account. If they're actually good,
            # heal the record (otherwise it shows "needs login" forever despite being
            # logged in); if dead, drop the file and fall through to a tracked re-login.
            if self._session_alive(page):
                self._record_login_success(acc)
                self.ctx[acc["id"]] = {"browser": browser, "context": context, "page": page}
                return page
            try:
                os.remove(state)
            except Exception:  # noqa: BLE001
                pass
            self.db.log(acc["business_id"], "self-heal",
                        f"{acc.get('label')}: saved session expired — re-logging in",
                        level="warn", account_id=acc["id"])
            if self._in_login_cooldown(acc):
                browser.close()
                raise SessionUnavailable(f"{acc.get('label')}: login retry scheduled later")

        # Attempt a tracked login (handles backoff, classification, recovery
        # counting and the human-handoff escalation). Raises SessionUnavailable.
        try:
            self._login_and_track(acc, page, context, state)
        except SessionUnavailable:
            try:
                browser.close()
            except Exception:  # noqa: BLE001
                pass
            raise
        self.ctx[acc["id"]] = {"browser": browser, "context": context, "page": page}
        return page

    # ── self-healing login helpers ────────────────────────────────────────────
    def _in_login_cooldown(self, acc) -> bool:
        """True while an account is waiting out its login-retry backoff."""
        if (acc.get("login_attempts") or 0) <= 0:
            return False  # never attempted (or just reset) — try now
        nxt = parse_iso(acc.get("next_login_attempt_at"))
        return nxt is not None and nxt > dt.datetime.now(dt.timezone.utc)

    def _session_alive(self, page) -> bool:
        """Is this restored session still logged in? Navigates to the dashboard."""
        try:
            openrent_login.nav(page, openrent_login.DASHBOARD_URL, wait_until="domcontentloaded")
            return openrent_login.is_logged_in(page)
        except Exception:  # noqa: BLE001
            return False  # treat an unreachable dashboard as a dead session

    def save_external_session(self, acc, page) -> bool:
        """Persist a logged-in session captured OUTSIDE page_for (e.g. the email
        confirmation browser) so future runs skip the password login entirely."""
        try:
            if openrent_login.is_logged_in(page):
                page.context.storage_state(path=self._state(acc))
                return True
        except Exception:  # noqa: BLE001
            pass
        return False

    def _is_unhealthy(self, acc) -> bool:
        """Does the DB record say this account isn't working? (Used to decide
        whether a freshly-validated/logged-in session should heal the record.)"""
        return (not acc.get("session_valid")) or (acc.get("login_attempts") or 0) > 0 \
            or bool(acc.get("needs_human")) or acc.get("status") in ("needs_login", "error")

    def _record_login_success(self, acc):
        """Mark an account healthy after a good login OR a validated restored
        session. Clears all failure state; if the account had logged in before and
        was unhealthy, this is a recovery — count it and log a green line."""
        is_initial = not acc.get("last_login_at")   # never logged in before
        was_unhealthy = self._is_unhealthy(acc)
        prior_attempts = acc.get("login_attempts") or 0
        patch = {
            "status": "live", "session_valid": True, "last_error": None,
            "failure_kind": None, "needs_human": False, "diagnosis": None,
            "login_attempts": 0, "next_login_attempt_at": None, "last_login_at": now_iso(),
        }
        is_recovery = was_unhealthy and not is_initial
        if is_recovery:
            patch["recovery_count"] = (acc.get("recovery_count") or 0) + 1
            patch["last_recovered_at"] = now_iso()
        self.db.update_account(acc["id"], patch)
        acc.update(patch)
        if is_recovery:
            note = (f"after {prior_attempts} failed attempt(s)" if prior_attempts
                    else "its session had expired")
            self.db.log(acc["business_id"], "recovered",
                        f"{acc.get('label')}: re-logged in automatically ({note})",
                        level="info", account_id=acc["id"])

    def _login_and_track(self, acc, page, context, state):
        """Run a login attempt and record the outcome. On success: save the
        session + heal the record (counting a recovery if it had a prior session).
        On failure: schedule a backoff retry, or hand off to a human once attempts
        are exhausted / the kind is terminal."""
        try:
            openrent_login.login(page, acc.get("email"), acc.get("password"))
        except openrent_login.LoginError as e:
            self._handle_login_failure(acc, getattr(e, "kind", openrent_login.KIND_UNKNOWN), str(e), page)
            raise SessionUnavailable(str(e))
        except Exception as e:  # noqa: BLE001 — nav timeout / proxy drop = transient network
            self._handle_login_failure(acc, openrent_login.KIND_NETWORK, _short(e), page)
            raise SessionUnavailable(str(e))

        # Success — persist the session and clear all failure state.
        context.storage_state(path=state)
        self._record_login_success(acc)

    def _handle_login_failure(self, acc, kind, detail, page=None):
        """Record a failed login: schedule a backoff retry, or escalate to a human
        once retries are exhausted or the failure is unrecoverable."""
        biz = acc["business_id"]
        label = acc.get("label")
        attempts = (acc.get("login_attempts") or 0) + 1
        terminal = kind in TERMINAL_LOGIN_KINDS or attempts >= MAX_LOGIN_ATTEMPTS
        reason = FAILURE_REASON.get(kind, "login failed")
        if terminal:
            # Raise the human-visible "needs login" tag. Keep gently re-checking ONLY
            # for connection blips (which never submitted a bad login); for anything
            # that actually failed a login, STOP — repeated failed logins are what get
            # an account locked. A human resumes it with "Try now" once it's fixed.
            if kind in SAFE_TO_RETRY_KINDS:
                nxt = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=LONG_RETRY_MIN)).isoformat()
                tail = f"still re-checking every {round(LONG_RETRY_MIN / 60)}h"
            else:
                nxt = None  # stop auto-retrying — don't risk locking the account
                tail = "auto-retry stopped (press Try now once it's sorted)"
            patch = {
                "status": "needs_login", "session_valid": False, "needs_human": True,
                "failure_kind": kind, "last_error": detail, "login_attempts": attempts,
                "next_login_attempt_at": nxt,
            }
            self.db.update_account(acc["id"], patch)
            acc.update(patch)
            self.db.log(biz, "login-failed",
                        f"{label}: needs a human — {reason} (after {attempts} tries; {tail})",
                        level="error", account_id=acc["id"])
            self._diagnose(acc, kind, detail, page)
        else:
            backoff = LOGIN_BACKOFF_MIN[min(attempts, len(LOGIN_BACKOFF_MIN)) - 1]
            nxt = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=backoff)).isoformat()
            patch = {
                # status 'live' (not 'needs_login') while in the fast-retry lane so the
                # UI shows "re-connecting N/5", not the human-handoff "needs login" tag.
                "status": "live",
                "session_valid": False, "failure_kind": kind, "last_error": detail,
                "login_attempts": attempts, "next_login_attempt_at": nxt, "needs_human": False,
            }
            self.db.update_account(acc["id"], patch)
            acc.update(patch)
            self.db.log(biz, "login-retry",
                        f"{label}: login attempt {attempts} failed — {reason}; retrying in {backoff} min",
                        level="warn", account_id=acc["id"])

    def _diagnose(self, acc, kind, detail, page=None):
        """Write a plain-English diagnosis for a terminal failure. Known kinds get
        a rule-based explanation; genuinely unknown failures are sent to Claude
        (advisory only — never edits anything)."""
        text = RULE_DIAGNOSIS.get(kind)
        if not text and kind == openrent_login.KIND_UNKNOWN:
            snapshot = ""
            if page is not None:
                try:
                    snapshot = (page.inner_text("body") or "")[:2000]
                except Exception:  # noqa: BLE001
                    pass
            text = llm.diagnose(self.cfg, {
                "label": acc.get("label"), "email": acc.get("email"),
                "kind": kind, "error": detail, "page_text": snapshot,
            }) or None
        if text:
            try:
                self.db.update_account(acc["id"], {"diagnosis": text})
                self.db.log(acc["business_id"], "diagnosis", f"{acc.get('label')}: {text[:180]}",
                            level="info", account_id=acc["id"])
            except Exception:  # noqa: BLE001
                pass

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


# ── proxy health + fallback ───────────────────────────────────────────────────
def _record_proxy_ok(db: DB, acc, info: dict):
    """Store the confirmed egress IP + location so the UI shows a green 'working'
    line. If the account was previously down, clear the alert flag and log that it
    came back."""
    was_down = acc.get("proxy_status") == "down"
    patch = {
        "proxy_ip": info.get("ip"),
        "proxy_city": info.get("city"),
        "proxy_country": info.get("country"),
        "proxy_status": "ok",
        "proxy_checked_at": now_iso(),
    }
    if was_down:
        patch["proxy_alerted_at"] = None
        patch["last_error"] = None
    db.update_account(acc["id"], patch)
    acc.update(patch)
    if was_down:
        where = info.get("city") or info.get("country") or "GB"
        db.log(acc["business_id"], "proxy-back",
               f"{acc.get('label')}: proxy back online — {info.get('ip')} · {where}",
               level="info", account_id=acc["id"])


def _record_proxy_down(db: DB, cfg, acc):
    """No credential in the pool can reach the internet for this account. Flag it
    red in the UI + the live log, and email Hugo once per outage."""
    already_alerted = bool(acc.get("proxy_alerted_at"))
    patch = {"proxy_status": "down", "proxy_checked_at": now_iso(), "last_error": "proxy offline"}
    db.update_account(acc["id"], patch)
    acc.update(patch)
    db.log(acc["business_id"], "proxy-down",
           f"{acc.get('label')}: proxy offline — no working proxy in the pool",
           level="error", account_id=acc["id"])
    if not already_alerted and alerts.proxy_offline(cfg, acc["id"]):
        # The route records proxy_alerted_at in the DB; mirror it in memory so we
        # don't re-POST within this process before the next account reload.
        acc["proxy_alerted_at"] = now_iso()


def _find_working_base(pool: list[str], start_idx: int, sticky_id: str):
    """Find a pool credential that can reach the internet for this account. Try the
    OTHER credentials first (the active one just failed), then the active one once
    more last — so a transient blip on the active proxy doesn't needlessly flip the
    whole fleet. Returns (index, info) or (None, {})."""
    n = len(pool)
    order = [(start_idx + k) % n for k in range(1, n)] + [start_idx]
    for j in order:
        ok, info = flashproxy.check_ip(pool[j], sticky_id=sticky_id)
        if ok:
            return j, info
    return None, {}


def check_proxies(db: DB, sessions: Sessions, cfg, accounts):
    """Confirm each account's proxy is alive (records its IP + location) and fall
    back to the next pool credential when the active one dies. Throttled per
    account (PROXY_CHECK_EVERY_MIN) and capped per tick (anti-burst)."""
    pool = flashproxy.pool(cfg)
    if not pool:
        return
    now = dt.datetime.now(dt.timezone.utc)
    due = []
    for a in accounts:
        if a.get("status") == "disabled":
            continue  # paused by a human — don't spend proxy data on it
        last = parse_iso(a.get("proxy_checked_at"))
        # Never-checked OR currently down → fast lane (re-check almost every tick) so
        # a new account never sits on "checking proxy…" and a dead proxy self-heals
        # inside a couple of minutes. Confirmed-'ok' accounts stay on the slow cadence.
        unhealthy = last is None or a.get("proxy_status") in ("down", "unknown")
        interval = PROXY_RECHECK_DOWN_MIN if unhealthy else PROXY_CHECK_EVERY_MIN
        if last and (now - last).total_seconds() < interval * 60:
            continue
        due.append(a)
    if not due:
        return
    # Fairness: never-checked first (proxy_checked_at IS NULL), then 'down', then the
    # oldest-checked 'ok' accounts. Without this, accounts low in rotation_order
    # re-qualify every 10 min and sit at the front, eating the per-tick budget — so a
    # freshly-added fleet at the tail is NEVER reached (the "checking proxy… forever" bug).
    def _due_key(a):
        last = parse_iso(a.get("proxy_checked_at"))
        never = 0 if last is None else 1                       # NULL first
        down = 0 if a.get("proxy_status") in ("down", "unknown") else 1
        ts = last.timestamp() if last else 0.0                 # then oldest-checked first
        return (never, down, ts)
    due.sort(key=_due_key)
    idx = sessions.proxy_index % len(pool)
    checked = 0
    for a in due:
        if checked >= MAX_PROXY_CHECKS_PER_TICK:
            break
        checked += 1
        ok, info = flashproxy.check_ip(pool[idx], sticky_id=a["id"])
        if ok:
            _record_proxy_ok(db, a, info)
            continue
        # Active credential failed for this account — hunt for a working one.
        new_idx, new_info = _find_working_base(pool, idx, a["id"])
        if new_idx is None:
            _record_proxy_down(db, cfg, a)
            continue
        if new_idx != idx:
            old = idx
            idx = new_idx
            sessions.proxy_index = new_idx
            db.set_proxy_index(new_idx)
            db.log(a["business_id"], "proxy-switch",
                   f"Switched all accounts to backup proxy #{new_idx + 1} — proxy #{old + 1} stopped working",
                   level="warn", account_id=a["id"])
        _record_proxy_ok(db, a, new_info)


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
        # Rotate which account scrapes which URL each cycle, so the scraping
        # footprint spreads evenly across the fleet over time instead of the same
        # accounts always carrying the same URLs (anti-overload, anti-pattern).
        offsets = state.get("scrape_offset", {})
        offset = int(offsets.get(biz, 0))
        offsets[biz] = offset + 1
        state["scrape_offset"] = offsets
        save_state(state)
        scrape_business(db, sessions, cfg, settings, biz, accounts, offset)


def scrape_business(db: DB, sessions: Sessions, cfg, settings, business_id, accounts, offset=0):
    urls = db.source_urls(business_id)
    biz_accounts = [a for a in accounts if a["business_id"] == business_id
                    and a.get("status") not in ("disabled", "needs_login", "pending_confirm")]
    if not urls or not biz_accounts:
        return
    db.log(business_id, "scrape", f"Scan: {len(urls)} search URLs across {len(biz_accounts)} accounts")
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=int(settings.get("only_listings_newer_than_days", 3)))
    found = new = 0
    for i, u in enumerate(urls):
        # Pace the scrape so an account isn't hit with back-to-back page loads.
        if i > 0:
            time.sleep(random.randint(2, 6))
        acc = biz_accounts[(i + offset) % len(biz_accounts)]
        try:
            page = sessions.page_for(acc)
            listings = openrent_listing.scrape_search(page, u["url"])
        except SessionUnavailable:
            continue  # login self-healing in progress — skip quietly (already logged)
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


def resolve_profile_name(acc: dict, settings: dict | None = None):
    """Resolve (first, last) for an account's OpenRent profile, or (None, None)
    when there's no usable source — the caller must REPORT those, never guess
    (e.g. the legacy gmail accounts that aren't 'Maria <surname>').

    Order:
      1. persona "Maria Smith"            -> ("Maria", "Smith")
      2. persona single token + m.<sn>@…  -> (persona, "<Sn>")
      3. no persona but m.<surname>@…     -> (persona_first_name|"Maria", "<Surname>")
      4. otherwise                         -> (None, None)
    """
    settings = settings or {}
    default_first = (settings.get("persona_first_name") or "Maria").strip() or "Maria"
    persona = (acc.get("persona") or "").strip()
    email = (acc.get("email") or "").strip().lower()

    # Surname embedded in a persona address m.<surname>@<domain> (the standard shape).
    email_surname = None
    local = email.split("@", 1)[0] if "@" in email else ""
    if "." in local:
        cand = local.split(".", 1)[1]   # the bit after the "m." initial
        if cand.isalpha():
            email_surname = cand.capitalize()

    if persona:
        parts = persona.split()
        if len(parts) >= 2:
            return parts[0], " ".join(parts[1:])
        return parts[0], (email_surname or "")   # single-token persona + email surname
    if email_surname:
        return default_first, email_surname
    return None, None


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
    proxy_base = sessions._active_base()  # live pool credential; sticky id added per account
    if not proxy_base:
        db.log(business_id, "error", "Account creation: no proxy_pool/default_proxy in config.json", level="warn")
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
        # NOTE: the profile name is set later by the ensure_profile_names tick step
        # — once the account is email-confirmed and logged in (session_valid). Doing
        # it here is unreliable (pre-confirm the edit page may not be accessible).
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


# OpenRent's real confirmation link carries an ?auth=<token> param, e.g.
#   https://www.openrent.co.uk/authentication/email?email=...&auth=<uuid>
# Match THAT first — the marketing links in the same welcome email merely contain
# the word "email" (utm_source=inlinedemail, utm_medium=email), so a loose keyword
# match would grab a homepage tracking URL and never actually confirm the account.
_CONFIRM_RE = re.compile(
    r"https?://(?:www\.)?openrent\.co\.uk/[^\s\"'<>]*\bauth=[^\s\"'<>&]+",
    re.IGNORECASE,
)
# Fallback for older-style links (path actually contains confirm/verify/activate).
_CONFIRM_RE_FALLBACK = re.compile(
    r"https?://(?:www\.)?openrent\.co\.uk/[^\s\"'<>]*"
    r"(?:confirm|verify|activate)[^\s\"'<>]*",
    re.IGNORECASE,
)


def _extract_confirm_url(*texts) -> str | None:
    for rx in (_CONFIRM_RE, _CONFIRM_RE_FALLBACK):
        for t in texts:
            if not t:
                continue
            m = rx.search(t)
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
        # Match by the account's unique persona address only — no date filter. The
        # welcome email's timestamp can land a second or two BEFORE the account
        # row's created_at (it's inserted before signup submits), and a >= filter
        # then silently drops the confirmation email, leaving the account stuck
        # unconfirmed. The address is unique per account, so this is safe.
        emails = db.received_emails_for(business_id, email)
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
        proxy_base = sessions._active_base()
        browser = None
        try:
            browser, page = sessions.fresh_proxied_browser(proxy_base, acc["id"])
            page.goto(confirm_url, wait_until="domcontentloaded")
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
            # Opening the confirm link logs the account in on THIS page. Capture
            # that session so the account never needs a fresh password login —
            # that doomed first login was the main cause of "needs login" on
            # brand-new accounts. If it isn't logged in here, recover_sessions
            # will do the first real login on the next tick.
            saved = sessions.save_external_session(acc, page)
            db.update_account(acc["id"], {
                "status": "live", "session_valid": saved,
                "confirmed_at": now_iso(), "last_error": None,
                "last_login_at": now_iso() if saved else None,
            })
            if src_email:
                db.mark_email_used(src_email["id"], email)
            db.log(business_id, "account-confirmed",
                   f"Confirmed {email} — account is live{'' if saved else ' (login pending)'}",
                   account_id=acc["id"])
        except Exception as e:  # noqa: BLE001
            db.log(business_id, "error", f"Confirm failed for {email}: {e}", level="warn", account_id=acc["id"])
        finally:
            if browser:
                try:
                    browser.close()
                except Exception:
                    pass


def recover_sessions(db: DB, sessions: Sessions, cfg, accounts):
    """Proactively (re)establish a logged-in session for accounts that need one —
    fresh accounts that have never logged in, and live accounts whose session
    expired — on a backoff schedule. This is what makes the system self-healing:
    logins are retried automatically (not just when there's outreach work to do)
    until they recover or get handed off to a human. Bounded per tick (anti-burst)
    and gated by each account's active window."""
    now = dt.datetime.now(dt.timezone.utc)
    candidates = []
    for a in accounts:
        # 'disabled' is a deliberate human off-switch; 'pending_confirm' is still
        # waiting for its email. Everything else that lacks a session is fair game
        # — including 'needs_login'/needs_human accounts (autopilot keeps trying
        # them on the slow lane; no button press required).
        if a.get("status") in ("disabled", "pending_confirm"):
            continue
        if a.get("session_valid"):
            continue  # already has a (believed-good) session
        if not within_active(a, cfg):
            continue  # respect the account's own active days/hours
        if (a.get("login_attempts") or 0) > 0:
            nxt = parse_iso(a.get("next_login_attempt_at"))
            if nxt is None:
                continue  # auto-retry deliberately stopped — wait for a human "Try now"
            if nxt > now:
                continue  # still inside the backoff window (fast or slow lane)
        candidates.append(a)
    # Fairest first: those waiting longest (oldest / no scheduled retry), then order.
    candidates.sort(key=lambda a: (a.get("next_login_attempt_at") or "", a.get("rotation_order", 0)))
    done = 0
    for a in candidates:
        if done >= MAX_RECOVER_PER_TICK:
            break
        done += 1
        try:
            sessions.page_for(a)  # side effect: validate / log in / track the outcome
        except SessionUnavailable:
            pass  # cooldown or already-recorded failure — nothing to add
        except Exception as e:  # noqa: BLE001
            db.log(a["business_id"], "error",
                   f"{a.get('label')}: session recovery error — {_short(e)}",
                   level="warn", account_id=a["id"])


def ensure_profile_names(db: DB, sessions: Sessions, cfg, settings, accounts):
    """Backfill the OpenRent profile First name (+ Surname) on accounts that don't
    have one yet (profile_name_set_at IS NULL). Reuses each account's session via
    page_for — gated on session_valid so a healthy account is named with ZERO
    logins (the key 'don't hammer logins' guard). Bounded per tick + active-hours
    gated. Idempotent: stamps profile_name_set_at on success / already-set, and on
    an account with no name source (so we stop re-checking it). New accounts get
    named here automatically once they're confirmed + logged in."""
    done = 0
    for a in accounts:
        if done >= MAX_PROFILE_NAMES_PER_TICK:
            break
        if a.get("status") in ("disabled", "pending_confirm"):
            continue
        if a.get("profile_name_set_at"):
            continue  # already handled
        if not a.get("session_valid"):
            continue  # only name accounts with a (believed-good) session → no login here
        if not within_active(a, cfg):
            continue
        first, last = resolve_profile_name(a, settings)
        if not first:
            # No usable name source (e.g. the legacy gmail accounts) — stamp so we
            # stop re-checking, and flag it for a human to set the name by hand.
            db.update_account(a["id"], {"profile_name_set_at": now_iso()})
            a["profile_name_set_at"] = now_iso()
            db.log(a["business_id"], "profile-name-skip",
                   f"{a.get('label') or a.get('email')}: no name source — set the profile name manually",
                   level="warn", account_id=a["id"])
            done += 1
            continue
        done += 1
        try:
            page = sessions.page_for(a)
        except SessionUnavailable:
            continue  # cooldown — try a later tick
        except Exception as e:  # noqa: BLE001
            db.log(a["business_id"], "error",
                   f"{a.get('label')}: profile-name session error — {_short(e)}",
                   level="warn", account_id=a["id"])
            continue
        try:
            status = openrent_signup.ensure_profile_name(page, first, last)
        except Exception as e:  # noqa: BLE001
            sessions.note_failure(a["id"]); sessions.heal(a)
            db.log(a["business_id"], "error", f"{a.get('label')}: profile-name error — {_short(e)}",
                   level="warn", account_id=a["id"])
            continue
        if status in (openrent_signup.NAME_SET, openrent_signup.NAME_ALREADY_SET):
            db.update_account(a["id"], {"profile_name_set_at": now_iso()})
            a["profile_name_set_at"] = now_iso()
            sessions.note_success(a["id"])
            db.log(a["business_id"], "profile-name-set",
                   f"{a.get('label') or a.get('email')}: profile name → {(first + ' ' + last).strip()} ({status})",
                   account_id=a["id"])
        else:
            # no-field/save-failed/nav-failed → most likely a 'session_valid' record
            # whose cookie silently died; heal it and retry next tick (don't stamp).
            sessions.note_failure(a["id"]); sessions.heal(a)
            db.log(a["business_id"], "error",
                   f"{a.get('label')}: profile name not set ({status}); will retry",
                   level="warn", account_id=a["id"])


def flag_security_alerts(db: DB):
    """Label any account that received a security email from OpenRent (e.g. an
    'account locked for security' notice) so a human can review and remove it.
    Read-only safety net — the system never auto-acts on these."""
    for em in db.security_emails():
        acc = db.account_by_email(em["business_id"], em.get("to_email"))
        if acc:
            subj = (em.get("subject") or "OpenRent security notice").strip()
            db.update_account(acc["id"], {
                "security_alert": True,
                "diagnosis": f"OpenRent sent a SECURITY email: \"{subj}\". Review this account and "
                             f"remove it manually if needed — the system won't touch it automatically.",
            })
            db.log(acc["business_id"], "security-alert",
                   f"{acc.get('label')}: OpenRent security email — {subj}",
                   level="warn", account_id=acc["id"])
        # Mark processed either way so we don't re-flag every tick.
        db.mark_email_used(em["id"], em.get("to_email"))


def run_rotation(db: DB, sessions: Sessions, cfg, settings, accounts):
    biz_ids = sorted({a["business_id"] for a in accounts})
    for business_id in biz_ids:
        targets = db.ready_targets(business_id)
        if not targets:
            continue
        elig = [a for a in accounts if a["business_id"] == business_id
                and a.get("status") not in ("disabled", "error", "needs_login", "pending_confirm")
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
                draft = llm.draft_outreach_full(cfg, {
                    "title": t.get("title"), "price_text": t.get("price_text"),
                    "postcode": t.get("postcode"), "landlord_name": t.get("landlord_name"),
                    "listing_url": t.get("listing_url"),
                    "external_listing_id": t.get("external_listing_id"),  # stable key for A/B assignment
                })
                msg = (draft.get("text") or "").strip()
                opener_variant = draft.get("variant_id")  # which A/B opener was used (None = single prompt)
                if not msg:
                    db.set_target(t["id"], {"status": "ready"})
                    continue
                res = openrent_enquiry.send_enquiry(
                    page, t.get("listing_url"), msg,
                    landlord_blacklisted=lambda name: db.blacklist_active(business_id, landlord_key(name)),
                )
            except SessionUnavailable:
                db.set_target(t["id"], {"status": "ready"})  # release the claim; account is mid-relogin
                continue
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
            db.set_target(t["id"], {"status": "contacted", "contacted_at": now_iso(), "contacted_by_account": acc["id"], "conversation_id": conv_id, "landlord_name": name, "landlord_key": key, "opener_variant": opener_variant})
            gap = int(settings.get("gap_between_sends_min", 4)) + random.randint(0, int(settings.get("gap_jitter_min", 3)))
            nxt = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=gap)).isoformat()
            db.update_account(acc["id"], {"messages_sent_today": acc.get("messages_sent_today", 0) + 1, "next_run_at": nxt, "last_run_at": now_iso(), "status": "live"})
            acc["messages_sent_today"] = acc.get("messages_sent_today", 0) + 1
            sent += 1
            db.log(business_id, "pitch-sent", f"Messaged {t.get('landlord_name') or 'landlord'} — {t.get('title') or t.get('listing_url')}", account_id=acc["id"])


def poll_replies(db: DB, sessions: Sessions, cfg, accounts):
    for acc in accounts:
        # Skip not-yet-confirmed accounts: logging them in here would fail and bump
        # them out of the confirm queue before their email is confirmed.
        if acc.get("status") in ("disabled", "error", "needs_login", "pending_confirm"):
            continue
        try:
            page = sessions.page_for(acc)
            threads = openrent_inbox.read_inbox(page)
        except SessionUnavailable:
            continue  # login self-healing in progress — skip quietly (already logged)
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
            # Don't stack a second draft if one is already waiting for approval (or
            # mid-send): a landlord double-texting before Hugo approves would
            # otherwise generate a duplicate pitch. Mirror handoff.ts's guard.
            if any(m.get("direction") == "outbound" and m.get("status") in ("draft", "queued", "sending") for m in msgs):
                continue
            ts = parse_iso(last.get("created_at"))
            if ts and (dt.datetime.now(dt.timezone.utc) - ts).total_seconds() < delay:
                continue
            history = [{"from": "us" if m["direction"] == "outbound" else "them", "text": m.get("body") or ""} for m in msgs]
            res = llm.draft_reply(cfg, history, conversation_id=c["id"])
            # BRAIN handoff: the landlord shared a number, so the app moved them to
            # a private WhatsApp chat (contact + pinned draft) and told us to post
            # NOTHING back on OpenRent. Store nothing → send_queued never sees it.
            if res.get("skip"):
                db.log(business_id, "reply-suppressed",
                       "Landlord shared a number — handed to WhatsApp; no OpenRent reply sent")
                continue
            reply = (res.get("text") or "").strip()
            if not reply:
                continue
            # The app decides draft-vs-send per stage (pitch is gated by its own
            # switch); fall back to the global toggle if an older app didn't say.
            status = res.get("status") or ("queued" if settings.get("reply_auto_send") else "draft")
            db.add_message(c["id"], "outbound", "ai", reply, status=status,
                           meta={"via": "openrent_ai_reply", "stage": res.get("stage")})


def send_queued(db: DB, sessions: Sessions, cfg, accounts):
    acc_by_id = {a["id"]: a for a in accounts}
    # Up to 30/tick (was 10) so a backlog of queued replies drains in a few ticks
    # instead of ~an hour; still gentle (~1 per account) and claim_message guards
    # against double-sends.
    for m in db.queued_outbound(limit=30):
        conv = m["conversation"]
        acc = acc_by_id.get(conv.get("openrent_account_id"))
        if not acc:
            continue
        if not db.claim_message(m["id"]):
            continue
        try:
            page = sessions.page_for(acc)
            res = openrent_inbox.send_reply(page, conv.get("external_thread_id"), m.get("body"))
        except SessionUnavailable:
            db.mark_message(m["id"], "queued")  # release the claim; retry once the account is back
            continue
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
    # Heartbeat FIRST, before any early-return — proves the worker loop is alive so
    # the app can flag "automation offline" if this timestamp goes stale (covers a
    # dead process AND a tick hung in a Playwright call, since the next write won't land).
    db.heartbeat()
    settings = db.get_settings()
    if not settings.get("enabled"):
        return
    accounts = db.accounts()

    # One bad step must NEVER abort the whole tick. Pre-fix, a crash in account
    # creation/confirmation aborted the tick before check_proxies ran, leaving the
    # newest accounts stuck on "checking proxy…" indefinitely.
    def _step(name, fn):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            print(f"[worker] {name} error: {_short(e)}")
        # Heartbeat after EVERY step (not just per-tick): a single tick can run for
        # minutes (cold-session warm-up, scraping 40 URLs, polling 32 inboxes), so a
        # per-tick heartbeat would look "offline" mid-tick. Per-step keeps it fresh
        # while still going stale if the worker truly dies or hangs inside a step.
        db.heartbeat()

    # Phase 2 runs even with zero accounts (it bootstraps the first ones) and before
    # the early-return below, so account creation/confirmation isn't blocked by an empty fleet.
    _step("maybe_create_accounts",    lambda: maybe_create_accounts(db, sessions, cfg, settings, accounts, state))
    _step("process_account_requests", lambda: process_account_requests(db, sessions, cfg, settings))  # on-demand "Create N now"
    _step("confirm_pending_accounts", lambda: confirm_pending_accounts(db, sessions, cfg))
    _step("flag_security_alerts",     lambda: flag_security_alerts(db))
    if not accounts:
        return
    today = london_now(cfg).strftime("%Y-%m-%d")
    for a in accounts:
        daily_reset(db, a, today)
    # Draft AI replies FIRST (DB + app route only, no browser) so they're never
    # starved by the slow/crash-prone Playwright steps below; then proxy health
    # (cheap ipinfo.io checks) BEFORE logins so logins reuse the live credential.
    # Every step is isolated so one failure can't skip the rest of the tick.
    _step("process_ai_replies", lambda: process_ai_replies(db, cfg, settings, accounts))
    # Send queued replies EARLY — right after they're drafted — so they go out
    # promptly and a backlog is never starved behind the slow scrape/poll steps
    # below (poll_replies alone reads ~60 inboxes and can run many minutes).
    _step("send_queued",        lambda: send_queued(db, sessions, cfg, accounts))
    _step("check_proxies",      lambda: check_proxies(db, sessions, cfg, accounts))
    _step("recover_sessions",   lambda: recover_sessions(db, sessions, cfg, accounts))
    _step("ensure_profile_names", lambda: ensure_profile_names(db, sessions, cfg, settings, accounts))
    _step("maybe_scrape",       lambda: maybe_scrape(db, sessions, cfg, settings, accounts, state))
    _step("run_rotation",       lambda: run_rotation(db, sessions, cfg, settings, accounts))
    _step("poll_replies",       lambda: poll_replies(db, sessions, cfg, accounts))


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
