"""TDD for the Rightmove enquiry flow: captcha solver + config/message.

No network, no browser — the captcha solver's HTTP and sleep are injected.
Run: cd scraper && .venv/bin/python -m pytest test_enquiry.py -q
"""
import json
import pytest

from captcha_solver import TwoCaptchaSolver, CaptchaError, _parse_json
from enquiry_config import build_enquiry_message, _DEFAULT_CONTACT
from rightmove_enquiry import contact_page_url


# ── A fake 2captcha HTTP backend ─────────────────────────────────────────────
class FakeHttp:
    """Scripts a sequence of (matcher, response) and records calls."""
    def __init__(self):
        self.calls = []
        self._submit_resp = json.dumps({"status": 1, "request": "ID123"})
        self._poll_resps = []  # list of json strings, consumed in order

    def submit_returns(self, body):
        self._submit_resp = body

    def poll_script(self, *bodies):
        self._poll_resps = list(bodies)

    def __call__(self, url, params):
        self.calls.append((url, params))
        if url.endswith("in.php"):
            return self._submit_resp
        if url.endswith("res.php") and params.get("action") == "getbalance":
            return json.dumps({"status": 1, "request": "12.50"})
        if url.endswith("res.php"):
            return self._poll_resps.pop(0) if self._poll_resps else json.dumps(
                {"status": 0, "request": "CAPCHA_NOT_READY"})
        raise AssertionError("unexpected url " + url)


def make_solver(http):
    # sleep is a no-op; first_wait/poll_interval irrelevant with the no-op sleep
    return TwoCaptchaSolver("KEY", http=http, sleep=lambda s: None,
                            first_wait=0, poll_interval=0, timeout=100)


# ── captcha: happy path ──────────────────────────────────────────────────────
def test_solve_returns_token_after_polling():
    http = FakeHttp()
    http.poll_script(
        json.dumps({"status": 0, "request": "CAPCHA_NOT_READY"}),
        json.dumps({"status": 0, "request": "CAPCHA_NOT_READY"}),
        json.dumps({"status": 1, "request": "TOKEN-ABC"}),
    )
    token = make_solver(http).solve_recaptcha_v2("SITEKEY", "https://x/y")
    assert token == "TOKEN-ABC"


def test_submit_sends_right_params():
    http = FakeHttp()
    http.poll_script(json.dumps({"status": 1, "request": "T"}))
    make_solver(http).solve_recaptcha_v2("SK", "https://page", invisible=True)
    submit = next(p for (u, p) in http.calls if u.endswith("in.php"))
    assert submit["method"] == "userrecaptcha"
    assert submit["googlekey"] == "SK"
    assert submit["pageurl"] == "https://page"
    assert submit["invisible"] == "1"


def test_invisible_flag_omitted_when_false():
    http = FakeHttp()
    http.poll_script(json.dumps({"status": 1, "request": "T"}))
    make_solver(http).solve_recaptcha_v2("SK", "https://page", invisible=False)
    submit = next(p for (u, p) in http.calls if u.endswith("in.php"))
    assert "invisible" not in submit


# ── captcha: error handling ──────────────────────────────────────────────────
def test_submit_rejected_raises():
    http = FakeHttp()
    http.submit_returns(json.dumps({"status": 0, "request": "ERROR_ZERO_BALANCE"}))
    with pytest.raises(CaptchaError, match="ERROR_ZERO_BALANCE"):
        make_solver(http).solve_recaptcha_v2("SK", "https://p")


def test_fatal_error_during_poll_raises():
    http = FakeHttp()
    http.poll_script(json.dumps({"status": 0, "request": "ERROR_KEY_DOES_NOT_EXIST"}))
    with pytest.raises(CaptchaError, match="fatal"):
        make_solver(http).solve_recaptcha_v2("SK", "https://p")


def test_unsolvable_surfaces():
    http = FakeHttp()
    http.poll_script(json.dumps({"status": 0, "request": "ERROR_CAPTCHA_UNSOLVABLE"}))
    with pytest.raises(CaptchaError, match="solve failed"):
        make_solver(http).solve_recaptcha_v2("SK", "https://p")


def test_timeout_when_never_ready():
    http = FakeHttp()
    # Always not-ready; force the monotonic clock past the deadline.
    solver = make_solver(http)
    ticks = iter([0, 1, 2, 200])
    solver._monotonic = lambda: next(ticks)
    with pytest.raises(CaptchaError, match="timed out"):
        solver.solve_recaptcha_v2("SK", "https://p")


def test_missing_key_raises_at_construction():
    with pytest.raises(CaptchaError):
        TwoCaptchaSolver("")


def test_balance_parses_float():
    http = FakeHttp()
    assert make_solver(http).balance() == 12.50


# ── funcaptcha (Arkose) ──────────────────────────────────────────────────────
def test_funcaptcha_submits_method_publickey_surl_blob():
    http = FakeHttp()
    http.poll_script(json.dumps({"status": 1, "request": "ARKOSE-TOKEN"}))
    token = make_solver(http).solve_funcaptcha(
        "PUBKEY", "https://page", surl="https://x.arkoselabs.com", blob="BLOB123")
    assert token == "ARKOSE-TOKEN"
    submit = next(p for (u, p) in http.calls if u.endswith("in.php"))
    assert submit["method"] == "funcaptcha"
    assert submit["publickey"] == "PUBKEY"
    assert submit["surl"] == "https://x.arkoselabs.com"
    assert submit["data[blob]"] == "BLOB123"


def test_funcaptcha_omits_blob_when_absent():
    http = FakeHttp()
    http.poll_script(json.dumps({"status": 1, "request": "T"}))
    make_solver(http).solve_funcaptcha("PUBKEY", "https://page")
    submit = next(p for (u, p) in http.calls if u.endswith("in.php"))
    assert "data[blob]" not in submit
    assert "surl" not in submit


def test_funcaptcha_submit_rejected_raises():
    http = FakeHttp()
    http.submit_returns(json.dumps({"status": 0, "request": "ERROR_GOOGLEKEY"}))
    with pytest.raises(CaptchaError, match="funcaptcha submit rejected"):
        make_solver(http).solve_funcaptcha("PUBKEY", "https://page")


def test_parse_json_tolerates_plaintext_error():
    assert _parse_json("ERROR_NO_SLOT_AVAILABLE")["request"] == "ERROR_NO_SLOT_AVAILABLE"
    assert _parse_json('{"status":1,"request":"x"}')["request"] == "x"


# ── message + config ─────────────────────────────────────────────────────────
def test_message_mentions_address_phone_and_elsie():
    msg = build_enquiry_message(
        {"address": "12 Bridge St, Coventry, CV1"},
        {"phone": "07426495169", "first_name": "Elsie"},
    )
    assert "12 Bridge St, Coventry, CV1" in msg
    assert "07426495169" in msg
    assert "Elsie" in msg          # so callbacks asking for Elsie are routed
    assert "cash buyer" in msg.lower()


def test_message_handles_missing_address():
    msg = build_enquiry_message({}, {"phone": "07426495169"})
    assert "your listing" in msg
    assert "07426495169" in msg


def test_default_contact_name_is_elsie():
    # The whole inbound triage depends on the enquiry name being Elsie.
    assert _DEFAULT_CONTACT["first_name"] == "Elsie"


# ── contact-page URL mapping ────────────────────────────────────────────────
def test_contact_url_from_standard_listing():
    u = contact_page_url("https://www.rightmove.co.uk/properties/154321088")
    assert u == ("https://www.rightmove.co.uk/property-for-sale/"
                 "contactBranch.html?propertyId=154321088")


def test_contact_url_strips_trailing_slash_and_fragment():
    u = contact_page_url("https://www.rightmove.co.uk/properties/154321088#/")
    assert "propertyId=154321088" in u


def test_contact_url_handles_query_suffix():
    u = contact_page_url("https://www.rightmove.co.uk/properties/99887766?channel=RES_BUY")
    assert "propertyId=99887766" in u


def test_contact_url_empty_when_no_id():
    u = contact_page_url("")
    assert u.endswith("propertyId=")
