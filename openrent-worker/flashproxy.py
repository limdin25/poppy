"""FlashProxy helper — turn a stored 'host:port:user:pass' string into a
Playwright proxy dict, one sticky session per account.

The per-account proxy string is entered in the Unico UI (Add account → Proxy)
and stored in openrent_account_secrets.proxy_session, e.g.:
    lite.flashproxy.io:6969:<user>:<pass>

Sticky-session syntax (confirmed Comet B3 — FlashProxy Residential Lite):
    username = <base>[-country-XX]-time-<minutes>-session-<id>
  example:    a1f4dlgalg-country-GB-time-1440-session-rabbm1zd
Each unique -session-<id> holds the SAME residential IP for -time-<minutes>
(max 1440 = 24h). A logged-in OpenRent account that hops IPs gets banned, so we
pin each account to ONE stable session id derived from its account id.
"""
from __future__ import annotations
import re
from typing import Optional

import requests  # already a worker dependency (requirements.txt)

STICKY_MAX_MINUTES = 1440  # FlashProxy caps a sticky IP at 24h.


def _session_token(sticky_id: str) -> str:
    """Stable 8-char alphanumeric session id from the account id, so the same
    account always requests the same sticky IP across worker restarts."""
    clean = re.sub(r"[^a-z0-9]", "", (sticky_id or "").lower())
    return (clean or "openrent")[:8].ljust(8, "0")


def parse_proxy(proxy_str: Optional[str], sticky_id: Optional[str] = None,
                minutes: int = STICKY_MAX_MINUTES, country: Optional[str] = "GB") -> Optional[dict]:
    """'lite.flashproxy.io:6969:user:pass' -> Playwright proxy dict.

    sticky_id: stable id per account (the account UUID) → same IP every run.
    minutes:   how long the sticky IP is held (1..1440). Default = max (24h).
    country:   ISO-2 to geo-pin the IP. Default 'GB' (OpenRent is UK; a UK IP is
               the most natural). Pass None to use any-country residential IPs.
    """
    if not proxy_str:
        return None
    parts = proxy_str.strip().split(":")
    if len(parts) < 2:
        return None
    host, port = parts[0], parts[1]
    username = parts[2] if len(parts) > 2 else None
    password = parts[3] if len(parts) > 3 else None

    # Build the sticky username unless one was already supplied with -session-.
    if sticky_id and username and "-session-" not in username:
        base = username
        if country and "-country-" not in base:
            base = f"{base}-country-{country.upper()}"
        if "-time-" not in base:
            base = f"{base}-time-{int(minutes)}"
        username = f"{base}-session-{_session_token(sticky_id)}"

    proxy: dict = {"server": f"http://{host}:{port}"}
    if username:
        proxy["username"] = username
    if password:
        proxy["password"] = password
    return proxy


# ── proxy pool + health check ────────────────────────────────────────────────
def pool(cfg: dict) -> list[str]:
    """The ordered list of FlashProxy base credentials to rotate through. Falls
    back to the single legacy `default_proxy` if no pool is configured."""
    p = [s for s in (cfg.get("proxy_pool") or []) if s]
    if not p and cfg.get("default_proxy"):
        p = [cfg["default_proxy"]]
    return p


def requests_proxies(proxy_str: Optional[str], sticky_id: Optional[str] = None) -> Optional[dict]:
    """A `requests`-style proxies dict for a stored proxy string, using the SAME
    sticky session id the Playwright browser uses — so an IP check leaves through
    the exact residential IP the account browses with."""
    p = parse_proxy(proxy_str, sticky_id=sticky_id)
    if not p:
        return None
    server = p["server"]  # http://host:port
    if p.get("username"):
        creds = p["username"] + (f":{p['password']}" if p.get("password") else "")
        server = server.replace("://", f"://{creds}@", 1)
    return {"http": server, "https": server}


def check_ip(proxy_str: Optional[str], sticky_id: Optional[str] = None,
             timeout: int = 20) -> tuple[bool, dict]:
    """Hit ipinfo.io through the proxy and return (ok, {ip, city, country}).
    ok=False means the proxy couldn't reach the internet (dead / out of credit /
    blocked) — the caller's cue to fall back to the next pool credential."""
    proxies = requests_proxies(proxy_str, sticky_id=sticky_id)
    if not proxies:
        return False, {}
    try:
        r = requests.get("https://ipinfo.io/json", proxies=proxies, timeout=timeout)
        r.raise_for_status()
        d = r.json() or {}
        ip = (d.get("ip") or "").strip()
        if not ip:
            return False, {}
        return True, {
            "ip": ip,
            "city": (d.get("city") or "").strip() or None,
            "country": (d.get("country") or "").strip().upper() or None,
        }
    except Exception:  # noqa: BLE001 — any failure = proxy can't reach the internet
        return False, {}
