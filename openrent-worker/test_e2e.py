"""End-to-end test of the OpenRent worker browser modules through the real
account + UK proxy. Saves the login session where the engine expects it so the
worker reuses it. Set OR_SEND=1 to actually send a real enquiry + reply.

Env: OR_EMAIL OR_PASS OR_PROXY [OR_SEARCH] [OR_SEND]
"""
import os, json
from playwright.sync_api import sync_playwright
import flashproxy, openrent_login, openrent_listing, openrent_enquiry, openrent_inbox, llm

EMAIL = os.environ["OR_EMAIL"]; PASS = os.environ["OR_PASS"]; PROXY = os.environ["OR_PROXY"]
ACCT_ID = "c60e2d61-3bb8-457b-8d60-0bf71dc41f0c"
SEARCH_URL = os.environ.get("OR_SEARCH", "https://www.openrent.co.uk/properties-to-rent/london")
SEND = os.environ.get("OR_SEND", "0") == "1"
SESS_DIR = "data/sessions"; SESS = f"{SESS_DIR}/{ACCT_ID}.json"


def banner(s): print("\n========== " + s + " ==========")


proxy = flashproxy.parse_proxy(PROXY, sticky_id=ACCT_ID)
print("PROXY user:", proxy["username"])

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, proxy=proxy)
    ctx = browser.new_context(storage_state=SESS) if os.path.exists(SESS) else browser.new_context()
    page = ctx.new_page(); page.set_default_timeout(60000)

    banner("LOGIN")
    page.goto("https://www.openrent.co.uk/", wait_until="domcontentloaded")
    if openrent_login.is_logged_in(page):
        print("already logged in (restored session)")
    else:
        ok = openrent_login.login(page, EMAIL, PASS)
        print("login returned:", ok)
    os.makedirs(SESS_DIR, exist_ok=True)
    ctx.storage_state(path=SESS)
    print("session saved ->", SESS, "| is_logged_in:", openrent_login.is_logged_in(page))

    banner("SCRAPE " + SEARCH_URL)
    listings = openrent_listing.scrape_search(page, SEARCH_URL)
    print("listings found:", len(listings))
    for l in listings[:6]:
        print(f"   id={l['external_listing_id']} | {str(l['title'])[:38]:38} | {l['price_text']} | {l['listing_url']}")
    if not listings:
        print("NO CARDS — diagnosing selectors on the live page:")
        for sel in ["a.pli.search-property-card", "a.pli", "[data-listing-id]",
                    "[data-property-id]", "a[id^='p']", "a[href*='/properties-to-rent/']",
                    ".pli", "[class*='property-card']"]:
            try: print(f"   {sel:42} -> {len(page.query_selector_all(sel))}")
            except Exception as e: print("   err", sel, e)
        page.screenshot(path="data/scrape_debug.png", full_page=False)
        print("   screenshot -> data/scrape_debug.png  | url:", page.url)

    thread_id = None
    if listings:
        target = listings[0]
        banner("DRAFT outreach for listing " + target["external_listing_id"])
        cfg = json.load(open("config.json"))
        msg = llm.draft_outreach(cfg, {
            "title": target["title"], "price_text": target["price_text"],
            "postcode": None, "landlord_name": None, "listing_url": target["listing_url"],
        })
        if not msg:
            msg = ("Hi, I came across your property and I'm very interested — is it still "
                   "available, and would it be possible to arrange a viewing? Thank you.")
        print("message:", msg)

        if SEND:
            banner("SEND ENQUIRY (REAL) -> " + target["listing_url"])
            res = openrent_enquiry.send_enquiry(page, target["listing_url"], msg)
            print("enquiry result:", res)
            page.screenshot(path="data/enquiry_after.png", full_page=False)
            thread_id = res.get("external_thread_id")
        else:
            print("(OR_SEND!=1 — not sending)")

    banner("READ INBOX")
    threads = openrent_inbox.read_inbox(page)
    print("threads found:", len(threads))
    for t in threads[:6]:
        last = t["messages"][0] if t["messages"] else {}
        print(f"   tid={t['external_thread_id']} | {str(t['landlord_name'])[:18]:18} | "
              f"{str(t['listing_title'])[:28]:28} | from={last.get('from')} | {str(last.get('text'))[:40]}")
    if not threads:
        page.screenshot(path="data/inbox_debug.png", full_page=False)
        print("   no threads — screenshot data/inbox_debug.png | url:", page.url)

    if SEND and thread_id:
        banner("SEND REPLY (REAL) on thread " + str(thread_id))
        rr = openrent_inbox.send_reply(page, thread_id, "Thank you — I look forward to hearing from you.")
        print("reply result:", rr)
        page.screenshot(path="data/reply_after.png", full_page=False)

    banner("DONE")
    browser.close()
