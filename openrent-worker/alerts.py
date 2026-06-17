"""Fire owner-facing alerts through the Unico app (keeps the Resend key on Vercel
only). Mirrors llm.py's worker-secret POST pattern.

POST {app_url}/api/openrent/proxy-alert  with header x-worker-secret.
  body: {"account_id": "..."}  -> {"sent": true|false}
The route emails Hugo and records proxy_alerted_at (idempotent per outage), so
returning sent=false here means the worker should try again next tick.
"""
from __future__ import annotations
import requests


def proxy_offline(cfg: dict, account_id: str) -> bool:
    url = cfg["app_url"].rstrip("/") + "/api/openrent/proxy-alert"
    try:
        r = requests.post(
            url,
            json={"account_id": account_id},
            headers={"x-worker-secret": cfg["worker_secret"], "Content-Type": "application/json"},
            timeout=30,
        )
        r.raise_for_status()
        return bool((r.json() or {}).get("sent"))
    except Exception as e:  # noqa: BLE001 — never let an alert failure crash the tick
        print(f"[alerts] proxy_offline failed: {e}")
        return False
