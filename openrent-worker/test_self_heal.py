"""Unit tests for the OpenRent worker's resilient-navigation + self-healing logic.

Pure-Python, no browser/network — uses fakes. Run:
    source .venv/bin/activate && python -m unittest test_self_heal -v
"""
import os
import tempfile
import unittest

import browser_util
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


if __name__ == "__main__":
    unittest.main()
