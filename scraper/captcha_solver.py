"""2Captcha reCAPTCHA solver — stdlib-only (no extra pip dependency).

Submits a reCAPTCHA v2 task to 2captcha (in.php), polls res.php until the
token is ready, and returns the g-recaptcha-response token. The caller injects
the token into the page with Playwright.

Used by the Rightmove enquiry form-filler (rightmove_enquiry.py). Key lives in
data/enquiry.json, never in code — see enquiry_config.py.
"""
import time
import json
import urllib.parse
import urllib.request


class CaptchaError(Exception):
    """Raised when 2captcha returns an error or never produces a token."""


# Errors that mean "stop, don't retry" vs transient ones worth resubmitting.
FATAL_ERRORS = {
    "ERROR_WRONG_USER_KEY", "ERROR_KEY_DOES_NOT_EXIST",
    "ERROR_ZERO_BALANCE", "ERROR_GOOGLEKEY",
}


class TwoCaptchaSolver:
    def __init__(self, api_key, *, http=None, sleep=time.sleep,
                 poll_interval=5.0, first_wait=15.0, timeout=180.0):
        if not api_key:
            raise CaptchaError("2captcha api key missing")
        self.api_key = api_key
        # http/sleep are injectable so the unit tests never touch the network.
        self._http = http or _urllib_get
        self._sleep = sleep
        self.poll_interval = poll_interval
        self.first_wait = first_wait
        self.timeout = timeout

    def balance(self):
        """Account balance in USD (float)."""
        body = self._http("https://2captcha.com/res.php", {
            "key": self.api_key, "action": "getbalance", "json": "1",
        })
        data = _parse_json(body)
        if str(data.get("status")) != "1":
            raise CaptchaError(f"balance check failed: {data.get('request')}")
        return float(data["request"])

    def solve_recaptcha_v2(self, sitekey, page_url, *, invisible=False):
        """Return a g-recaptcha-response token for the given sitekey/page."""
        captcha_id = self._submit(sitekey, page_url, invisible)
        return self._poll(captcha_id)

    # ── internals ──────────────────────────────────────────────────────────
    def _submit(self, sitekey, page_url, invisible):
        params = {
            "key": self.api_key,
            "method": "userrecaptcha",
            "googlekey": sitekey,
            "pageurl": page_url,
            "json": "1",
        }
        if invisible:
            params["invisible"] = "1"
        data = _parse_json(self._http("https://2captcha.com/in.php", params))
        if str(data.get("status")) != "1":
            req = data.get("request", "unknown")
            raise CaptchaError(f"submit rejected: {req}")
        return data["request"]

    def _poll(self, captcha_id):
        self._sleep(self.first_wait)
        deadline = self._monotonic() + self.timeout
        while self._monotonic() < deadline:
            data = _parse_json(self._http("https://2captcha.com/res.php", {
                "key": self.api_key, "action": "get",
                "id": captcha_id, "json": "1",
            }))
            request = data.get("request", "")
            if str(data.get("status")) == "1":
                return request
            if request == "CAPCHA_NOT_READY":  # 2captcha's spelling
                self._sleep(self.poll_interval)
                continue
            if request in FATAL_ERRORS:
                raise CaptchaError(f"fatal: {request}")
            # Other transient errors (e.g. unsolvable) — surface, caller decides.
            raise CaptchaError(f"solve failed: {request}")
        raise CaptchaError("timed out waiting for captcha token")

    # patched in tests
    def _monotonic(self):
        return time.monotonic()


def _urllib_get(url, params):
    full = url + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(full, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def _parse_json(body):
    try:
        return json.loads(body)
    except (ValueError, TypeError):
        # Defensive: 2captcha returns plain text on some edge errors.
        return {"status": "0", "request": (body or "").strip()}
