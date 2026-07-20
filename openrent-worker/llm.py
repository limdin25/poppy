"""Ask the Unico app for the AI message (keeps the Anthropic key on Vercel only).

POST {app_url}/api/openrent/draft  with header x-worker-secret.
  outreach: {"mode":"outreach","listing":{...}}                         -> {"text": "..."}
  reply:    {"mode":"reply","history":[{from,text},...],
             "conversation_id":"..."}  -> {"text","stage","status","handoff"}
"""
from __future__ import annotations
import random
import time
import requests

# Transient failures (a brief Anthropic blip, a 5xx, a network wobble) self-heal
# within seconds, so retry a few times with exponential backoff + jitter rather than
# waiting a whole cron cycle. A 4xx (bad worker secret, malformed request) won't fix
# itself, so don't retry it. Still returns {} once exhausted, so callers degrade safely.
_RETRY_BACKOFF_S = [1.0, 3.0, 7.0]


def draft_full(cfg: dict, payload: dict) -> dict:
    """POST to the app and return the full JSON response ({} on any error)."""
    url = cfg["app_url"].rstrip("/") + "/api/openrent/draft"
    last_err: Exception | None = None
    for attempt in range(len(_RETRY_BACKOFF_S) + 1):
        try:
            r = requests.post(
                url,
                json=payload,
                headers={"x-worker-secret": cfg["worker_secret"], "Content-Type": "application/json"},
                timeout=30,
            )
            # Don't retry client errors (4xx) — they won't fix themselves.
            if 400 <= r.status_code < 500:
                print(f"[llm] draft client error {r.status_code}; not retrying")
                return {}
            r.raise_for_status()
            return r.json() or {}
        except Exception as e:  # noqa: BLE001 — transient (5xx / timeout / conn drop)
            last_err = e
            if attempt < len(_RETRY_BACKOFF_S):
                delay = _RETRY_BACKOFF_S[attempt] + random.uniform(0, 0.5)  # jitter avoids a thundering herd
                print(f"[llm] draft attempt {attempt + 1} failed ({e}); retrying in {delay:.1f}s")
                time.sleep(delay)
    print(f"[llm] draft failed after {len(_RETRY_BACKOFF_S) + 1} attempts: {last_err}")
    return {}


def draft(cfg: dict, payload: dict) -> str:
    return draft_full(cfg, payload).get("text", "") or ""


def draft_outreach(cfg: dict, listing: dict) -> str:
    return draft(cfg, {"mode": "outreach", "listing": listing})


def draft_outreach_full(cfg: dict, listing: dict) -> dict:
    """First message, full response. Returns {text, variant_id}: variant_id is the
    A/B opener variant the app assigned (None when no A/B test is running), which
    the worker stores on the target so the Tower can compare variants."""
    return draft_full(cfg, {"mode": "outreach", "listing": listing})


def draft_reply(cfg: dict, history: list[dict], conversation_id: str | None = None) -> dict:
    """Staged reply. Returns the full response {text, stage, status, handoff}.
    Passing conversation_id lets the app pick the stage, inject the pitch's £
    figures and run the landlord-number handoff."""
    payload: dict = {"mode": "reply", "history": history}
    if conversation_id:
        payload["conversation_id"] = conversation_id
    return draft_full(cfg, payload)


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
