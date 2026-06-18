"""Unit tests for the OpenRent profile-name backfill logic (pure-Python, no browser).

  * worker.resolve_profile_name        — account dict -> (first, last), never guess
  * openrent_signup.ensure_profile_name — idempotent set + verify-by-re-read
  * openrent_login.classify_failure     — body-text wrong-password detection

Run: source .venv/bin/activate && python -m unittest test_profile_name -v
"""
import unittest
from unittest import mock

import openrent_login
import openrent_signup as sg
import worker


# ── resolve_profile_name ──────────────────────────────────────────────────────
class TestResolveName(unittest.TestCase):
    def r(self, acc, settings=None):
        return worker.resolve_profile_name(acc, settings or {})

    def test_persona_two_tokens(self):
        self.assertEqual(self.r({"persona": "Maria Smith", "email": "m.smith@x.com"}),
                         ("Maria", "Smith"))

    def test_persona_single_token_uses_email_surname(self):
        self.assertEqual(self.r({"persona": "Maria", "email": "m.jones@x.com"}),
                         ("Maria", "Jones"))

    def test_no_persona_email_surname_default_first(self):
        # m.taylor@… with no persona -> default first "Maria" + Taylor
        self.assertEqual(self.r({"persona": "", "email": "m.taylor@mail.nextpubli.com"},
                                {"persona_first_name": "Maria"}),
                         ("Maria", "Taylor"))

    def test_casing_normalised(self):
        self.assertEqual(self.r({"persona": None, "email": "m.WHITE@x.com"}),
                         ("Maria", "White"))

    def test_legacy_gmail_no_source(self):
        self.assertEqual(self.r({"persona": "", "email": "marknoah2024@gmail.com"}),
                         (None, None))
        self.assertEqual(self.r({"persona": None, "email": "marknoah2024+1@gmail.com"}),
                         (None, None))

    def test_default_first_setting_respected(self):
        self.assertEqual(self.r({"persona": "", "email": "m.evans@x.com"},
                                {"persona_first_name": "Lucy"}),
                         ("Lucy", "Evans"))


# ── ensure_profile_name (FakePage) ──────────────────────────────────────────────
class FakeInput:
    def __init__(self, page, field):
        self.page, self.field = page, field

    def input_value(self):
        return self.page.values.get(self.field, "")

    def fill(self, v):
        self.page.fills.append((self.field, v))
        self.page.pending[self.field] = v

    def is_visible(self):
        return True

    def click(self):
        if self.page.save_persists:
            self.page.values.update(self.page.pending)
            self.page.pending = {}


class FakePage:
    """Models /account/edit: input_value() returns committed values; clicking Save
    commits pending fills only when save_persists is True."""
    def __init__(self, first="", surname="", first_present=True, save_persists=True, goto_raises=False):
        self.values = {"FirstName": first, "Surname": surname}
        self.pending = {}
        self.fills = []
        self.first_present = first_present
        self.save_persists = save_persists
        self.goto_raises = goto_raises

    def goto(self, url, wait_until=None, timeout=None):
        if self.goto_raises:
            raise TimeoutError("nav failed")
        return {"url": url}

    def wait_for_timeout(self, ms):
        pass

    def wait_for_load_state(self, state, timeout=None):
        pass

    def query_selector(self, sel):
        if sel in sg.FIRST_NAME_SELS:
            return FakeInput(self, "FirstName") if self.first_present else None
        if sel in sg.SURNAME_SELS:
            return FakeInput(self, "Surname")
        return None

    def query_selector_all(self, sel):
        return [FakeInput(self, "save")] if sel in sg.PROFILE_SAVE_SELS else []


class TestEnsureName(unittest.TestCase):
    def test_already_set_no_write(self):
        p = FakePage(first="Maria")
        self.assertEqual(sg.ensure_profile_name(p, "Maria", "Hughes"), sg.NAME_ALREADY_SET)
        self.assertEqual(p.fills, [])  # never wrote

    def test_already_set_case_insensitive(self):
        p = FakePage(first="maria")
        self.assertEqual(sg.ensure_profile_name(p, "Maria", "Smith"), sg.NAME_ALREADY_SET)
        self.assertEqual(p.fills, [])

    def test_set_when_blank(self):
        p = FakePage(first="", save_persists=True)
        self.assertEqual(sg.ensure_profile_name(p, "Maria", "Hughes"), sg.NAME_SET)
        self.assertIn(("FirstName", "Maria"), p.fills)
        self.assertIn(("Surname", "Hughes"), p.fills)

    def test_no_field_when_logged_out(self):
        p = FakePage(first_present=False)
        self.assertEqual(sg.ensure_profile_name(p, "Maria", "Hughes"), sg.NAME_NO_FIELD)

    def test_save_failed_when_not_persisted(self):
        p = FakePage(first="", save_persists=False)
        self.assertEqual(sg.ensure_profile_name(p, "Maria", "Hughes"), sg.NAME_SAVE_FAILED)

    def test_nav_failed(self):
        p = FakePage(goto_raises=True)
        with mock.patch("browser_util.time.sleep"):  # skip retry backoff
            self.assertEqual(sg.ensure_profile_name(p, "Maria", "Hughes"), sg.NAME_NAV_FAILED)

    def test_empty_first_is_no_field(self):
        self.assertEqual(sg.ensure_profile_name(FakePage(), "", "Hughes"), sg.NAME_NO_FIELD)


# ── classify_failure: body-text wrong password ──────────────────────────────────
class ClassifyPage:
    def __init__(self, body, url="https://www.openrent.co.uk/account/simplelogon"):
        self._body, self._url = body, url

    @property
    def url(self):
        return self._url

    def query_selector(self, sel):
        return None  # no captcha, no span.field-validation-error

    def inner_text(self, sel):
        return self._body


class TestClassify(unittest.TestCase):
    def test_body_wrong_password_is_bad_credentials(self):
        kind, _ = openrent_login.classify_failure(
            ClassifyPage("Login was unsuccessful. The user name or password provided is incorrect."))
        self.assertEqual(kind, openrent_login.KIND_BAD_CREDENTIALS)

    def test_locked_beats_bad_credentials(self):
        kind, _ = openrent_login.classify_failure(
            ClassifyPage("Your account has been locked for security. Password provided is incorrect."))
        self.assertEqual(kind, openrent_login.KIND_LOCKED)

    def test_plain_no_indicator_is_unknown(self):
        kind, _ = openrent_login.classify_failure(ClassifyPage("Welcome to OpenRent"))
        self.assertEqual(kind, openrent_login.KIND_UNKNOWN)


if __name__ == "__main__":
    unittest.main()
