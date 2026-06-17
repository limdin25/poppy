"""Ask the Unico app for the AI message (keeps the Anthropic key on Vercel only).

POST {app_url}/api/openrent/draft  with header x-worker-secret.
  outreach: {"mode":"outreach","listing":{...}}            -> {"text": "..."}
  reply:    {"mode":"reply","history":[{from,text},...]}    -> {"text": "..."}
"""
from __future__ import annotations
import requests


def draft(cfg: dict, payload: dict) -> str:
    url = cfg["app_url"].rstrip("/") + "/api/openrent/draft"
    try:
        r = requests.post(
            url,
            json=payload,
            headers={"x-worker-secret": cfg["worker_secret"], "Content-Type": "application/json"},
            timeout=30,
        )
        r.raise_for_status()
        return (r.json() or {}).get("text", "") or ""
    except Exception as e:  # noqa: BLE001
        print(f"[llm] draft failed: {e}")
        return ""


def draft_outreach(cfg: dict, listing: dict) -> str:
    return draft(cfg, {"mode": "outreach", "listing": listing})


def draft_reply(cfg: dict, history: list[dict]) -> str:
    return draft(cfg, {"mode": "reply", "history": history})


def diagnose(cfg: dict, payload: dict) -> str:
    """Ask the app (Claude, key stays on Vercel) to explain a login failure we
    couldn't classify, in plain English for Hugo. Advisory only — never edits
    anything. Returns "" on any error so the engine keeps running.

    POST {app_url}/api/openrent/diagnose  -> {"diagnosis": "..."}
    """
    url = cfg["app_url"].rstrip("/") + "/api/openrent/diagnose"
    try:
        r = requests.post(
            url,
            json=payload,
            headers={"x-worker-secret": cfg["worker_secret"], "Content-Type": "application/json"},
            timeout=30,
        )
        r.raise_for_status()
        return (r.json() or {}).get("diagnosis", "") or ""
    except Exception as e:  # noqa: BLE001
        print(f"[llm] diagnose failed: {e}")
        return ""
