"""Unit tests for the OpenRent worker's resilient-navigation + self-healing logic.

Pure-Python, no browser/network — uses fakes. Run:
    source .venv/bin/activate && python -m unittest test_self_heal -v
"""
import os
import datetime as dt
import tempfile
import unittest
from unittest import mock

import browser_util
import openrent_login
import worker


# ── fakes ─────────────────────────────────────────────────────────────────────
class FakePage:
    """page.goto that fails the first `fail_times` calls, then succeeds."""
    def __init__(self, fail_times=0, exc=TimeoutError("Timeout 30000ms exceeded")):
        self.fail_times = fail_times
        self.calls = 0
        self.exc = exc

    def goto(self, url, wait_until=None, timeout=None):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise self.exc
        return {"url": url, "status": 200}


class FakeBrowser:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class FakeDB:
    def __init__(self):
        self.logs = []
        self.account_patches = []

    def log(self, business_id, event, message="", level="info", account_id=None, meta=None):
        self.logs.append({"event": event, "message": message, "level": level, "account_id": account_id})

    def update_account(self, account_id, patch):
        self.account_patches.append((account_id, patch))


def make_sessions(tmpdir):
    """A Sessions with a fake DB, pointed at a temp state dir (no real browser)."""
    s = worker.Sessions.__new__(worker.Sessions)
    s.pw = None
    s.cfg = {"headless": True}
    s.db = FakeDB()
    s.ctx = {}
    s.fail_counts = {}
    s.state_dir = tmpdir
    return s


ACC = {"id": "acc-123", "business_id": "biz-1", "label": "Test acct"}


# ── nav (resilient goto) ──────────────────────────────────────────────────────
class TestNav(unittest.TestCase):
    def test_success_first_try(self):
        p = FakePage(fail_times=0)
        res = browser_util.nav(p, "https://x", sleep=lambda *_: None)
        self.assertEqual(p.calls, 1)
        self.assertEqual(res["status"], 200)

    def test_retries_then_succeeds(self):
        p = FakePage(fail_times=1)  # first call times out, second works
        res = browser_util.nav(p, "https://x", attempts=2, sleep=lambda *_: None)
        self.assertEqual(p.calls, 2)
        self.assertEqual(res["status"], 200)

    def test_raises_after_all_attempts_fail(self):
        p = FakePage(fail_times=5)
        with self.assertRaises(TimeoutError):
            browser_util.nav(p, "https://x", attempts=2, sleep=lambda *_: None)
        self.assertEqual(p.calls, 2)  # exactly `attempts` tries, no more

    def test_passes_timeout_through(self):
        seen = {}

        class P:
            def goto(self, url, wait_until=None, timeout=None):
                seen["timeout"] = timeout
                return True
        browser_util.nav(P(), "https://x", timeout_ms=45000, sleep=lambda *_: None)
        self.assertEqual(seen["timeout"], 45000)


# ── heal_action (graduated decision) ──────────────────────────────────────────
class TestHealAction(unittest.TestCase):
    def test_tiers(self):
        self.assertEqual(browser_util.heal_action(0, threshold=2), "none")
        self.assertEqual(browser_util.heal_action(1, threshold=2), "none")
        self.assertEqual(browser_util.heal_action(2, threshold=2), "recycle")
        self.assertEqual(browser_util.heal_action(3, threshold=2), "recycle")
        self.assertEqual(browser_util.heal_action(4, threshold=2), "reset")
        self.assertEqual(browser_util.heal_action(99, threshold=2), "reset")


# ── Sessions self-healing (with fakes, no real browser) ───────────────────────
class TestSessionsHealing(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.s = make_sessions(self.tmp)

    def test_failure_counter_increments_and_resets(self):
        self.assertEqual(self.s.note_failure("acc-123"), 1)
        self.assertEqual(self.s.note_failure("acc-123"), 2)
        self.s.note_success("acc-123")
        self.assertEqual(self.s.note_failure("acc-123"), 1)

    def test_recycle_closes_and_drops_context(self):
        br = FakeBrowser()
        self.s.ctx["acc-123"] = {"browser": br, "context": object(), "page": object()}
        self.s.recycle("acc-123")
        self.assertNotIn("acc-123", self.s.ctx)
        self.assertTrue(br.closed)

    def test_recycle_unknown_id_is_safe(self):
        self.s.recycle("nope")  # must not raise

    def test_reset_removes_saved_session_file(self):
        path = self.s._state(ACC)
        with open(path, "w") as f:
            f.write("{}")
        self.assertTrue(os.path.exists(path))
        self.s.reset(ACC)
        self.assertFalse(os.path.exists(path))

    def test_heal_none_below_threshold(self):
        self.s.fail_counts[ACC["id"]] = 1
        self.assertEqual(self.s.heal(ACC), "none")
        self.assertEqual(self.s.db.logs, [])

    def test_heal_recycle_at_threshold(self):
        br = FakeBrowser()
        self.s.ctx[ACC["id"]] = {"browser": br, "context": object(), "page": object()}
        self.s.fail_counts[ACC["id"]] = 2
        self.assertEqual(self.s.heal(ACC), "recycle")
        self.assertNotIn(ACC["id"], self.s.ctx)
        self.assertTrue(br.closed)
        self.assertTrue(any(l["event"] == "self-heal" for l in self.s.db.logs))

    def test_heal_reset_at_double_threshold(self):
        path = self.s._state(ACC)
        with open(path, "w") as f:
            f.write("{}")
        self.s.fail_counts[ACC["id"]] = 4
        self.assertEqual(self.s.heal(ACC), "reset")
        self.assertFalse(os.path.exists(path))
        self.assertTrue(self.s.db.account_patches)  # session_valid flipped


# ── login failure classification ──────────────────────────────────────────────
class _Elem:
    def __init__(self, text=""):
        self._t = text

    def inner_text(self):
        return self._t


class FakeLoginPage:
    """Minimal page for classify_failure: substring-matched selectors + body/url."""
    def __init__(self, selectors=None, body="", url=""):
        self._sel = selectors or {}
        self._body = body
        self.url = url

    def query_selector(self, sel):
        for key, elem in self._sel.items():
            if key in sel:
                return elem
        return None

    def inner_text(self, _sel):
        return self._body


class TestClassifyFailure(unittest.TestCase):
    def test_captcha(self):
        kind, _ = openrent_login.classify_failure(FakeLoginPage(selectors={"recaptcha": _Elem()}))
        self.assertEqual(kind, openrent_login.KIND_CAPTCHA)

    def test_bad_credentials(self):
        page = FakeLoginPage(selectors={"field-validation-error": _Elem("Incorrect password")})
        kind, detail = openrent_login.classify_failure(page)
        self.assertEqual(kind, openrent_login.KIND_BAD_CREDENTIALS)
        self.assertIn("Incorrect", detail)

    def test_banned(self):
        kind, _ = openrent_login.classify_failure(FakeLoginPage(body="Your account has been suspended."))
        self.assertEqual(kind, openrent_login.KIND_BANNED)

    def test_locked(self):
        kind, _ = openrent_login.classify_failure(FakeLoginPage(body="Your account has been locked for security."))
        self.assertEqual(kind, openrent_login.KIND_LOCKED)

    def test_unconfirmed(self):
        kind, _ = openrent_login.classify_failure(FakeLoginPage(body="Please confirm your email to continue."))
        self.assertEqual(kind, openrent_login.KIND_UNCONFIRMED)

    def test_unknown(self):
        kind, _ = openrent_login.classify_failure(FakeLoginPage(body="welcome to openrent"))
        self.assertEqual(kind, openrent_login.KIND_UNKNOWN)


# ── self-healing login: backoff, escalation, recovery counting ─────────────────
def _patch(patches, key):
    """The latest update_account patch containing `key`, or {}."""
    for _id, p in reversed(patches):
        if key in p:
            return p
    return {}


class TestLoginSelfHeal(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.s = make_sessions(self.tmp)

    def test_backoff_on_transient_failure(self):
        acc = {"id": "x", "business_id": "b", "label": "A", "login_attempts": 0}
        self.s._handle_login_failure(acc, openrent_login.KIND_NETWORK, "timeout")
        self.assertEqual(acc["login_attempts"], 1)
        self.assertFalse(acc.get("needs_human"))
        self.assertNotEqual(acc.get("status"), "needs_login")
        self.assertIsNotNone(acc.get("next_login_attempt_at"))
        self.assertTrue(any(l["event"] == "login-retry" for l in self.s.db.logs))

    def test_escalates_after_max_attempts_but_keeps_retrying(self):
        acc = {"id": "x", "business_id": "b", "label": "A",
               "login_attempts": worker.MAX_LOGIN_ATTEMPTS - 1}
        self.s._handle_login_failure(acc, openrent_login.KIND_NETWORK, "timeout")
        self.assertTrue(acc["needs_human"])
        self.assertEqual(acc["status"], "needs_login")
        # autopilot never stops: a slow-lane retry is still scheduled.
        self.assertIsNotNone(acc.get("next_login_attempt_at"))
        self.assertTrue(any(l["event"] == "login-failed" for l in self.s.db.logs))
        # known kind → rule-based diagnosis stored (no AI call).
        self.assertIsNotNone(_patch(self.s.db.account_patches, "diagnosis").get("diagnosis"))

    def test_banned_escalates_immediately(self):
        acc = {"id": "x", "business_id": "b", "label": "A", "login_attempts": 0}
        self.s._handle_login_failure(acc, openrent_login.KIND_BANNED, "suspended")
        self.assertTrue(acc["needs_human"])
        self.assertEqual(acc["failure_kind"], openrent_login.KIND_BANNED)

    def test_locked_stops_immediately_no_hammering(self):
        # A security lock must NOT be retried — more failed logins deepen it.
        acc = {"id": "x", "business_id": "b", "label": "A", "login_attempts": 0}
        self.s._handle_login_failure(acc, openrent_login.KIND_LOCKED, "locked for security")
        self.assertTrue(acc["needs_human"])
        self.assertEqual(acc["failure_kind"], openrent_login.KIND_LOCKED)
        self.assertIsNone(acc["next_login_attempt_at"])      # auto-retry stopped

    def test_unknown_stops_after_max(self):
        # "Can't log in, unclear why" submitted real failed logins → stop after the
        # cap (don't keep hammering and risk a lock).
        acc = {"id": "x", "business_id": "b", "label": "A",
               "login_attempts": worker.MAX_LOGIN_ATTEMPTS - 1}
        with mock.patch.object(worker.llm, "diagnose", return_value="diag"):
            self.s._handle_login_failure(acc, openrent_login.KIND_UNKNOWN, "no indicator")
        self.assertTrue(acc["needs_human"])
        self.assertIsNone(acc["next_login_attempt_at"])      # stopped

    def test_network_keeps_rechecking_after_max(self):
        # A connection blip never submitted a bad login → safe to keep re-checking.
        acc = {"id": "x", "business_id": "b", "label": "A",
               "login_attempts": worker.MAX_LOGIN_ATTEMPTS - 1}
        self.s._handle_login_failure(acc, openrent_login.KIND_NETWORK, "timeout")
        self.assertTrue(acc["needs_human"])
        self.assertIsNotNone(acc["next_login_attempt_at"])   # slow-lane re-check kept

    def test_successful_login_counts_recovery(self):
        acc = {"id": "x", "business_id": "b", "label": "A",
               "login_attempts": 2, "recovery_count": 1, "last_login_at": "2026-06-17T10:00:00+00:00"}
        ctx = mock.Mock()
        with mock.patch.object(openrent_login, "login", return_value=True):
            self.s._login_and_track(acc, object(), ctx, os.path.join(self.tmp, "x.json"))
        self.assertEqual(acc["status"], "live")
        self.assertTrue(acc["session_valid"])
        self.assertEqual(acc["login_attempts"], 0)
        self.assertEqual(acc["recovery_count"], 2)        # bumped from 1
        self.assertIsNotNone(acc["last_recovered_at"])
        self.assertTrue(any(l["event"] == "recovered" for l in self.s.db.logs))

    def test_first_login_is_not_a_recovery(self):
        acc = {"id": "y", "business_id": "b", "label": "B",
               "login_attempts": 0, "recovery_count": 0, "last_login_at": None}
        ctx = mock.Mock()
        with mock.patch.object(openrent_login, "login", return_value=True):
            self.s._login_and_track(acc, object(), ctx, os.path.join(self.tmp, "y.json"))
        self.assertTrue(acc["session_valid"])
        self.assertEqual(acc.get("recovery_count", 0), 0)  # initial login, not a recovery
        self.assertFalse(any(l["event"] == "recovered" for l in self.s.db.logs))


# ── recover_sessions candidate selection ──────────────────────────────────────
class TestRecoverSessions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.s = make_sessions(self.tmp)

    def test_selects_due_and_skips_others(self):
        cfg = {"timezone": "Europe/London"}
        allday = {"active_days": worker.DOW, "active_hours_start": "00:00", "active_hours_end": "23:59"}
        past = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)).isoformat()
        future = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat()
        accs = [
            {"id": "valid", "business_id": "b", "status": "live", "session_valid": True, "rotation_order": 0, **allday},
            {"id": "disabled", "business_id": "b", "status": "disabled", "session_valid": False, "rotation_order": 1, **allday},
            {"id": "pending", "business_id": "b", "status": "pending_confirm", "session_valid": False, "rotation_order": 2, **allday},
            {"id": "fresh", "business_id": "b", "status": "live", "session_valid": False, "login_attempts": 0, "rotation_order": 3, **allday},
            {"id": "needslogin", "business_id": "b", "status": "needs_login", "needs_human": True,
             "session_valid": False, "login_attempts": 5, "next_login_attempt_at": past, "rotation_order": 4, **allday},
            {"id": "cooldown", "business_id": "b", "status": "live", "session_valid": False,
             "login_attempts": 2, "next_login_attempt_at": future, "rotation_order": 5, **allday},
        ]
        called = []

        def fake_page_for(a):
            called.append(a["id"])
            raise worker.SessionUnavailable("test")
        self.s.page_for = fake_page_for
        worker.recover_sessions(self.s.db, self.s, cfg, accs)
        # fresh (due now) + needslogin (slow-lane due) are tried; valid/disabled/pending/cooldown skipped.
        self.assertEqual(set(called), {"fresh", "needslogin"})

    def test_skips_stopped_accounts(self):
        # An account whose auto-retry was deliberately stopped (next_login_attempt_at
        # NULL while login_attempts>0) must NOT be retried — it waits for a human.
        cfg = {"timezone": "Europe/London"}
        allday = {"active_days": worker.DOW, "active_hours_start": "00:00", "active_hours_end": "23:59"}
        accs = [{"id": "stopped", "business_id": "b", "status": "needs_login", "needs_human": True,
                 "session_valid": False, "login_attempts": 3, "next_login_attempt_at": None,
                 "rotation_order": 0, **allday}]
        called = []
        self.s.page_for = lambda a: called.append(a["id"])
        worker.recover_sessions(self.s.db, self.s, cfg, accs)
        self.assertEqual(called, [])


if __name__ == "__main__":
    unittest.main()
