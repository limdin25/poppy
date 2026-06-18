"""OpenRent enquiry send — wired from Comet B2 + verified live (2026-06-16).

send_enquiry(page, listing_url, message, landlord_blacklisted=None) -> dict:
  {"ok": bool, "external_thread_id": str|None, "landlord_name": str|None,
   "skipped_blacklist": bool, "error": str|None}

Flow (verified live): the enquiry form is at /messagelandlord/<listingId>. We
read the landlord name ("Meet the Landlord — Naza B."), optionally check the
blacklist BEFORE sending, click the "Click here … without requesting a viewing"
toggle (x-on:click="isRequestViewing = false") to reveal the message box (this
also avoids OpenRent's phone-verification gate), fill the REQUIRED Subject +
Message, and submit. Success = redirect to /messages/<threadId>.
"""
from __future__ import annotations
import re

from browser_util import nav

BASE = "https://www.openrent.co.uk"
# Real DOM (verified live): textarea name is "Message" (id MessageLandlordMessage),
# hidden until the "Click here" toggle (x-on:click="isRequestViewing = false").
MSG_TEXTAREA = "textarea[name='Message']"
MSG_TEXTAREA_FALLBACK = "#MessageLandlordMessage"
MSG_ONLY_LINKS = [
    "[x-on\\:click=\"isRequestViewing = false\"]",
    "text=Click here to send a message",
]
SUBJECT_SEL = "input[name='Subject']"
SUBMIT_SELS = [
    "form[action*='messagelandlord'] button[type='submit']",
    "form[action*='messagelandlord'] input[type='submit']",
    "button[type='submit']",
]
LANDLORD_NAME_SELS = [
    "p.fs-body-large-1.fw-medium.text-center",
    "p.fs-body-large-1.fw-medium",
    "p.fs-body-large-1",
]
MODAL_SEL = "#vt-popup-modal"
SUCCESS_TEXT = "sent and delivered"


def _listing_id(url):
    m = re.search(r"/(\d+)(?:[/?#]|$)", url or "")
    return m.group(1) if m else None


def _landlord_name(page):
    for sel in LANDLORD_NAME_SELS:
        try:
            el = page.query_selector(sel)
            if el:
                t = (el.inner_text() or "").strip()
                if t and len(t) < 60:
                    return t
        except Exception:
            pass
    return None


def send_enquiry(page, listing_url, message, landlord_blacklisted=None):
    lid = _listing_id(listing_url)
    if not lid:
        return {"ok": False, "external_thread_id": None, "landlord_name": None,
                "skipped_blacklist": False, "error": "no listing id in url"}

    nav(page, f"{BASE}/messagelandlord/{lid}", wait_until="domcontentloaded")
    try:
        page.wait_for_timeout(800)
    except Exception:
        pass

    landlord = _landlord_name(page)

    # Blacklist check BEFORE sending (plan: check landlord name across all accounts).
    if landlord and callable(landlord_blacklisted) and landlord_blacklisted(landlord):
        return {"ok": False, "external_thread_id": None, "landlord_name": landlord,
                "skipped_blacklist": True, "error": "landlord blacklisted"}

    # Switch to message-only mode (avoids required viewing-date fields).
    for sel in MSG_ONLY_LINKS:
        try:
            el = page.query_selector(sel)
            if el and el.is_visible():
                el.click()
                break
        except Exception:
            continue

    ta = None
    for sel in (MSG_TEXTAREA, MSG_TEXTAREA_FALLBACK):
        try:
            ta = page.wait_for_selector(sel, timeout=8000, state="visible")
            if ta:
                break
        except Exception:
            ta = None
    if not ta:
        return {"ok": False, "external_thread_id": None, "landlord_name": landlord,
                "skipped_blacklist": False,
                "error": "message box not available (already enquired or layout changed)"}

    ta.fill(message)

    # Subject is a REQUIRED field (verified live) — submit is blocked without it.
    try:
        subj = page.query_selector(SUBJECT_SEL)
        if subj:
            subj.fill("A quick idea for your property")
    except Exception:
        pass

    submitted = False
    for sel in SUBMIT_SELS:
        try:
            btn = page.query_selector(sel)
            if btn and btn.is_visible():
                btn.click()
                submitted = True
                break
        except Exception:
            continue
    if not submitted:
        return {"ok": False, "external_thread_id": None, "landlord_name": landlord,
                "skipped_blacklist": False, "error": "submit button not found"}

    try:
        page.wait_for_load_state("networkidle", timeout=15000)
    except Exception:
        pass

    def _ok(tid):
        return {"ok": True, "external_thread_id": tid, "landlord_name": landlord,
                "skipped_blacklist": False, "error": None}

    # Success 1: redirect to /messages/<threadId>.
    m = re.search(r"/messages/(\d+)", page.url or "")
    if m:
        return _ok(m.group(1))

    # Success 2: confirmation modal (recover a thread id if present).
    if page.query_selector(MODAL_SEL):
        link = page.query_selector("a[href*='/messages/']")
        tid = None
        if link:
            mm = re.search(r"/messages/(\d+)", link.get_attribute("href") or "")
            tid = mm.group(1) if mm else None
        return _ok(tid)

    # Success 3: "Sent and delivered" text.
    try:
        if SUCCESS_TEXT in (page.content() or "").lower():
            return _ok(None)
    except Exception:
        pass

    return {"ok": False, "external_thread_id": None, "landlord_name": landlord,
            "skipped_blacklist": False, "error": "no success signal after send"}
