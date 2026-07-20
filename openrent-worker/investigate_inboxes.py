"""One-off: log into real OpenRent accounts and dump their ACTUAL /myenquiries
inbox, to check whether landlord replies are sitting UNREAD (never synced to the
app DB). Reuses the worker's saved session cookies + the same FlashProxy sticky
proxy per account, so it sees exactly what the worker should see.

Usage: python3 investigate_inboxes.py <acc_id> [<acc_id> ...]
"""
from __future__ import annotations
import sys, os, json
from playwright.sync_api import sync_playwright

import flashproxy
from db import DB
from worker import load_config

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://www.openrent.co.uk"
INBOX = f"{BASE}/myenquiries"
THREAD_CARD = "div[id^='thread-']"


def _txt(node, sel):
    try:
        el = node.query_selector(sel)
        return ((el.inner_text() or "").strip() or None) if el else None
    except Exception:
        return None


def dump_account(pw, cfg, db, acc):
    state = os.path.join(HERE, "data", "sessions", f"{acc['id']}.json")
    if not os.path.exists(state):
        return {"label": acc.get("label"), "error": "no saved session"}
    base = flashproxy.pool(cfg)[db.get_proxy_index() % len(flashproxy.pool(cfg))]
    proxy = flashproxy.parse_proxy(base, sticky_id=acc["id"])
    browser = pw.chromium.launch(headless=True, proxy=proxy)
    ctx = browser.new_context(storage_state=state)
    page = ctx.new_page()
    out = {"label": acc.get("label"), "acc_id": acc["id"]}
    try:
        page.goto(INBOX, wait_until="domcontentloaded", timeout=45000)
        # If the session is dead we get bounced to /login
        if "/login" in (page.url or "") or "signin" in (page.url or "").lower():
            out["error"] = f"session expired -> redirected to {page.url}"
            return out
        try:
            page.wait_for_selector(THREAD_CARD, timeout=12000)
        except Exception:
            out["error"] = "no thread cards (empty inbox or layout changed)"
            out["page_title"] = page.title()
            return out
        # Scroll to force any lazy-load, then count EVERY card.
        for _ in range(8):
            page.mouse.wheel(0, 20000)
            page.wait_for_timeout(400)
        cards = page.query_selector_all(THREAD_CARD)
        threads = []
        for card in cards:
            prefix = (_txt(card, "p.mb-0.fst-italic") or "")
            sender = "us" if prefix.lower().startswith("you") else "them"
            tnode = card.query_selector("time.timeago, time")
            ts = None
            if tnode:
                ts = tnode.get_attribute("datetime") or ((tnode.inner_text() or "").strip() or None)
            threads.append({
                "id": (card.get_attribute("id") or ""),
                "landlord": _txt(card, "span.line-clamp-1"),
                "preview": _txt(card, "p.mb-1.line-clamp-1"),
                "sender": sender,
                "ts": ts,
            })
        # Detect pagination / load-more controls.
        body = (page.content() or "")
        pager = any(s in body.lower() for s in ["pagination", "next page", "load more", "show more"])
        them = [t for t in threads if t["sender"] == "them"]
        out.update({
            "total_threads_visible": len(threads),
            "threads_awaiting_reply (them-latest)": len(them),
            "has_pagination_hint": pager,
            "recent_them": [
                {"landlord": t["landlord"], "ts": t["ts"], "preview": (t["preview"] or "")[:50]}
                for t in them[:15]
            ],
        })
        return out
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {str(e)[:120]}"
        return out
    finally:
        try:
            browser.close()
        except Exception:
            pass


def main():
    ids = sys.argv[1:]
    cfg = load_config()
    db = DB(cfg)
    accts = {a["id"]: a for a in db.accounts()}
    targets = [accts[i] for i in ids if i in accts]
    with sync_playwright() as pw:
        for acc in targets:
            res = dump_account(pw, cfg, db, acc)
            print(json.dumps(res, indent=2, default=str))
            print("-" * 70)


if __name__ == "__main__":
    main()
