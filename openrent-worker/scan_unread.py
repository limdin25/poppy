"""Scan accounts' OpenRent UNREAD inbox (/myenquiries?Filter=10) to find landlord
replies that were never synced to the app DB. Unread = the account never opened
the thread = the worker never processed that reply (buried below the top-10 list
during the high-volume blast). Prints per-account unread inbound + a fleet total."""
from __future__ import annotations
import sys, os, json
from playwright.sync_api import sync_playwright
import flashproxy
from db import DB
from worker import load_config

UNREAD = "https://www.openrent.co.uk/myenquiries?Filter=10"
CARD = "div[id^='thread-']"


def txt(n, s):
    try:
        e = n.query_selector(s); return ((e.inner_text() or "").strip() or None) if e else None
    except Exception:
        return None


def scan_one(pw, cfg, db, acc):
    base = flashproxy.pool(cfg)[db.get_proxy_index() % len(flashproxy.pool(cfg))]
    proxy = flashproxy.parse_proxy(base, sticky_id=acc["id"])
    b = pw.chromium.launch(headless=True, proxy=proxy)
    try:
        page = b.new_context(storage_state=os.path.join("data", "sessions", f"{acc['id']}.json")).new_page()
        page.goto(UNREAD, wait_until="domcontentloaded", timeout=40000)
        if "/login" in (page.url or ""):
            return {"label": acc.get("label"), "error": "session expired"}
        page.wait_for_timeout(2500)
        cards = page.query_selector_all(CARD)
        them = []
        for c in cards:
            prefix = (txt(c, "p.mb-0.fst-italic") or "")
            if prefix.lower().startswith("you"):
                continue  # latest is ours, not an inbound reply
            tn = c.query_selector("time.timeago, time")
            ts = (tn.get_attribute("datetime") or (tn.inner_text() or "").strip()) if tn else None
            them.append({"who": txt(c, "span.line-clamp-1"), "ts": ts,
                         "preview": (txt(c, "p.mb-1.line-clamp-1") or "")[:55]})
        return {"label": acc.get("label"), "unread_total": len(cards), "unread_inbound": len(them), "items": them}
    except Exception as e:  # noqa: BLE001
        return {"label": acc.get("label"), "error": f"{type(e).__name__}: {str(e)[:90]}"}
    finally:
        try:
            b.close()
        except Exception:
            pass


def main():
    cfg = load_config(); db = DB(cfg)
    accts = {a["id"]: a for a in db.accounts()}
    ids = sys.argv[1:] or list(accts.keys())
    fleet_inbound = 0
    with sync_playwright() as pw:
        for i in ids:
            if i not in accts:
                continue
            r = scan_one(pw, cfg, db, accts[i])
            fleet_inbound += r.get("unread_inbound", 0)
            print(json.dumps(r, default=str))
    print(f"\n==== FLEET UNREAD INBOUND REPLIES (missed): {fleet_inbound} across {len(ids)} accounts ====")


if __name__ == "__main__":
    main()
