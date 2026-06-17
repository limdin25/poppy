"""OpenRent messages inbox + replies — wired from Comet B2 (steps 5-6).

read_inbox(page) -> list of thread dicts:
  {
    "external_thread_id": str,
    "landlord_name": str | None,
    "listing_title": str | None,
    "listing_url": str | None,
    "messages": [
      {"external_id": str, "from": "them" | "us", "text": str, "ts": str | None}
    ],
  }

We read the inbox list page (/myenquiries) and return the LATEST message of each
thread as a single-message list — cheap (no per-thread page loads) and enough for
the engine, which only acts on inbound ("them") messages in threads we started.
external_id = "<threadId>:<timestamp>" so each new reply dedups cleanly. The
worker ticks ~every 20s, so multiple replies between polls is rare.

send_reply(page, external_thread_id, message) -> {"ok": bool, "error": str|None}
"""
from __future__ import annotations
import re

from browser_util import nav

BASE = "https://www.openrent.co.uk"
INBOX_URL = f"{BASE}/myenquiries"
THREAD_CARD = "div[id^='thread-']"
REPLY_TEXTAREA = "#message-compose-textarea"
REPLY_SEND_BTN = "#send-message-button"


def _digits(s):
    m = re.search(r"(\d+)", s or "")
    return m.group(1) if m else None


def _text(node, selector):
    try:
        el = node.query_selector(selector)
        if el:
            return ((el.inner_text() or "").strip()) or None
    except Exception:
        pass
    return None


def read_inbox(page):
    nav(page, INBOX_URL, wait_until="domcontentloaded")
    try:
        page.wait_for_selector(THREAD_CARD, timeout=10000)
    except Exception:
        return []  # empty inbox or layout changed
    threads = []
    for card in page.query_selector_all(THREAD_CARD):
        thread_id = _digits(card.get_attribute("id") or "")
        if not thread_id:
            continue
        landlord = _text(card, "span.line-clamp-1")
        title_link = card.query_selector("a.link-offset-2")
        listing_title = ((title_link.inner_text() or "").strip() or None) if title_link else None
        href = title_link.get_attribute("href") if title_link else None
        listing_url = (BASE + href) if href and href.startswith("/") else href
        preview = _text(card, "p.mb-1.line-clamp-1")
        prefix = (_text(card, "p.mb-0.fst-italic") or "")
        sender = "us" if prefix.lower().startswith("you") else "them"
        ts = None
        tnode = card.query_selector("time.timeago, time")
        if tnode:
            ts = tnode.get_attribute("datetime") or ((tnode.inner_text() or "").strip() or None)
        messages = []
        if preview:
            messages.append({
                "external_id": f"{thread_id}:{ts or preview}",
                "from": sender,
                "text": preview,
                "ts": ts,
            })
        threads.append({
            "external_thread_id": thread_id,
            "landlord_name": landlord,
            "listing_title": listing_title,
            "listing_url": listing_url,
            "messages": messages,
        })
    return threads


def send_reply(page, external_thread_id, message):
    if not external_thread_id:
        return {"ok": False, "error": "no thread id"}
    nav(page, f"{BASE}/messages/{external_thread_id}", wait_until="domcontentloaded")
    try:
        ta = page.wait_for_selector(REPLY_TEXTAREA, timeout=10000)
    except Exception:
        return {"ok": False, "error": "reply textarea not found"}
    ta.fill(message)
    btn = page.query_selector(REPLY_SEND_BTN)
    if not btn:
        return {"ok": False, "error": "send button not found"}
    try:
        btn.click()
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"send click failed: {e}"}

    # Reply posts via AJAX (/messaging/send) — no full navigation.
    try:
        page.wait_for_load_state("networkidle", timeout=12000)
    except Exception:
        pass

    # Success: the compose box clears on send.
    try:
        if (page.eval_on_selector(REPLY_TEXTAREA, "el => el.value") or "").strip() == "":
            return {"ok": True, "error": None}
    except Exception:
        pass
    # Fallback: our text now appears in the thread.
    try:
        snippet = (message or "")[:40]
        if snippet and snippet in (page.content() or ""):
            return {"ok": True, "error": None}
    except Exception:
        pass
    return {"ok": False, "error": "no success signal after reply send"}
