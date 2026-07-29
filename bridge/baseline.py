"""Save and restore the whole voice configuration.

    python3 -m bridge.baseline --save        overwrite the snapshot with what is live
    python3 -m bridge.baseline --restore     put the snapshot back, live, now
    python3 -m bridge.baseline --diff        what has drifted since the snapshot

Why this exists. Every dial that decides how she sounds lives in one Supabase
row, which is the right place for it: Hugo can change anything from the agent
page and the next call picks it up with no deploy. The cost of that convenience
is that a good configuration can be lost by one careless slider, and on a bad
call nobody remembers which of nine settings moved.

So the good one is committed to the repo as baseline.json, next to the code it
belongs with, and restoring it is one command. Hugo, on the first configuration
that actually closed a call: "lock this in and lets improve from here".

The snapshot holds the system prompt too, which is the part most worth
protecting: it is 2000 words that took a day of live calls to get right.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

from . import config

SNAPSHOT = Path(__file__).resolve().parent / "baseline.json"
TABLE = "wk_agent_channel_settings"


def _headers() -> dict[str, str]:
    key = config.key("SUPABASE_SERVICE_ROLE_KEY", required=True)
    return {"apikey": key, "Authorization": f"Bearer {key}",
            "Content-Type": "application/json"}


def live() -> dict:
    url = config.key("SUPABASE_URL", required=True)
    req = urllib.request.Request(
        f"{url}/rest/v1/{TABLE}?select=fish_config&channel=eq.voice", headers=_headers())
    with urllib.request.urlopen(req, timeout=15) as resp:
        rows = json.loads(resp.read() or b"[]")
    return (rows[0].get("fish_config") or {}) if rows else {}


def push(cfg: dict) -> dict:
    url = config.key("SUPABASE_URL", required=True)
    req = urllib.request.Request(
        f"{url}/rest/v1/{TABLE}?channel=eq.voice",
        data=json.dumps({"fish_config": cfg}).encode(),
        headers={**_headers(), "Prefer": "return=representation"}, method="PATCH")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())[0]["fish_config"]


def _short(v: object) -> str:
    s = str(v)
    return s if len(s) <= 46 else f"{s[:43]}... ({len(s)} chars)"


def diff(a: dict, b: dict) -> list[str]:
    out = []
    for k in sorted(set(a) | set(b)):
        if a.get(k) != b.get(k):
            out.append(f"  {k}\n      snapshot: {_short(a.get(k))}\n      live    : {_short(b.get(k))}")
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Save or restore the voice configuration.")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--save", action="store_true", help="snapshot what is live now")
    g.add_argument("--restore", action="store_true", help="put the snapshot back live")
    g.add_argument("--diff", action="store_true", help="show what has drifted")
    args = p.parse_args(argv)

    try:
        current = live()
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"Could not read the live settings: {e}")
        return 1

    if args.save:
        SNAPSHOT.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n")
        print(f"Saved {len(current)} settings to {SNAPSHOT.name}. Commit it.")
        return 0

    if not SNAPSHOT.exists():
        print(f"No snapshot at {SNAPSHOT}. Run --save first.")
        return 1
    saved = json.loads(SNAPSHOT.read_text())

    if args.diff:
        changes = diff(saved, current)
        if not changes:
            print("Live settings match the snapshot exactly.")
            return 0
        print(f"{len(changes)} setting(s) differ from the snapshot:\n")
        print("\n".join(changes))
        return 0

    changes = diff(saved, current)
    if not changes:
        print("Already matches the snapshot, nothing to do.")
        return 0
    back = push(saved)
    print(f"Restored {len(back)} settings. {len(changes)} had drifted:")
    print("\n".join(c.splitlines()[0] for c in changes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
