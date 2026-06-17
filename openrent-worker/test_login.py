"""One-off: prove a real OpenRent login works through the FlashProxy UK IP,
using the worker's own flashproxy.py + openrent_login.py. Creds via env."""
import os
from playwright.sync_api import sync_playwright
import flashproxy
import openrent_login

EMAIL = os.environ["OR_EMAIL"]
PASS = os.environ["OR_PASS"]
PROXY = os.environ["OR_PROXY"]

proxy = flashproxy.parse_proxy(PROXY, sticky_id="test-mark-1")
print("PROXY server  :", proxy["server"])
print("PROXY username:", proxy["username"])
print("PROXY haspass :", bool(proxy.get("password")))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, proxy=proxy)
    page = browser.new_context().new_page()
    page.set_default_timeout(60000)

    # 1) confirm the egress IP/country (is it really a UK residential IP?)
    try:
        page.goto("https://ipinfo.io/json", wait_until="domcontentloaded", timeout=60000)
        print("EGRESS:", (page.inner_text("body") or "").replace("\n", " ")[:400])
    except Exception as e:
        print("EGRESS check failed:", e)

    # 2) real login via the worker's code
    try:
        ok = openrent_login.login(page, EMAIL, PASS)
        print("LOGIN returned:", ok)
    except openrent_login.NeedsManualLogin as e:
        print("NEEDS MANUAL LOGIN:", e)
    except Exception as e:
        print("LOGIN ERROR:", type(e).__name__, e)

    print("FINAL URL:", page.url)
    print("is_logged_in():", openrent_login.is_logged_in(page))
    print("has profile-menu:", bool(page.query_selector("a.profile-menu")))
    print("has log-out-btn :", bool(page.query_selector("a.log-out-btn")))
    print("has Your Enquiries link:", bool(page.query_selector("a[href='/myenquiries']")))
    os.makedirs("data", exist_ok=True)
    page.screenshot(path="data/test_login.png", full_page=False)
    print("screenshot -> data/test_login.png")
    browser.close()
