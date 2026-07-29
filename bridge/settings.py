"""Live settings, read from Supabase before each call.

Whatever Hugo saves at /admin/crm/agent/fish reaches the next call with no
deploy and no restart. That round trip is the whole point: a settings page that
does not reach the thing it configures is worse than no settings page, because
it looks like it worked.

Fails soft on purpose. If Supabase is unreachable, or the row is missing, or the
JSON is malformed, the call still happens on the built-in defaults. Nobody wants
a dialer that stops because a settings lookup timed out.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

from . import config

TABLE = "wk_agent_channel_settings"
CHANNEL = "voice"


def fish_config() -> dict:
    """The saved Fish settings, or {} if there are none or anything goes wrong."""
    url = config.key("SUPABASE_URL")
    key = config.key("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return {}
    req = urllib.request.Request(
        f"{url}/rest/v1/{TABLE}?select=fish_config&channel=eq.{CHANNEL}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            rows = json.loads(resp.read() or b"[]")
    except (urllib.error.URLError, OSError, ValueError):
        return {}
    if not rows or not isinstance(rows, list):
        return {}
    cfg = rows[0].get("fish_config") or {}
    return cfg if isinstance(cfg, dict) else {}


def apply(cfg: dict) -> list[str]:
    """Push saved values onto the config module. Returns what changed, for the log.

    Only keys actually present are applied, so anything Hugo has not touched
    keeps the measured default rather than being overwritten with a blank.
    """
    changed: list[str] = []
    mapping = {
        "voice_id": "FISH_VOICE",
        "model": "FISH_MODEL",
        "speed": "FISH_SPEED",
        "volume": "FISH_VOLUME",
        "temperature": "FISH_TEMPERATURE",
        "top_p": "FISH_TOP_P",
        "chunk_length": "FISH_CHUNK",
    }
    for src, dest in mapping.items():
        value = cfg.get(src)
        if value in (None, ""):
            continue
        try:
            current = getattr(config, dest)
            setattr(config, dest, type(current)(value))
            changed.append(f"{src}={value}")
        except (TypeError, ValueError):
            continue
    return changed
