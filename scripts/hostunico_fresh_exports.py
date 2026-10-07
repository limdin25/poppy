"""Opt-in export acceleration for a bounded human-requested fresh supply run.

Known adverts remain in their original CSV exports. This only saves duplicate
network requests for adverts already saved since `verified_after` (at most 14
days back), never changes records or sends messages. The manifest itself still
expires within 24 hours.

A fresh run must be signed in. Without sign-in SpareRoom hides phone numbers,
and a phone-less save would mark those adverts as known for every later run.
"""
import json
from pathlib import Path
import time

LOOKBACK_SECONDS = 14 * 86400


def _manifest_after(home, run_id, country, now=None):
    """The verified_after stamp when this run is a fresh supply run, else None."""
    stamp = time.time() if now is None else now
    path = Path(home) / 'ops/fresh-export-runs.json'
    if country != 'uk' or not path.exists():
        return None
    try:
        config = json.loads(path.read_text())
        runs = config['run_ids']
        after, expires = config['verified_after'], config['expires_at']
        if (not isinstance(runs, list) or not runs or any(type(x) is not int or x <= 0 for x in runs)
                or run_id not in runs or type(after) not in (int, float) or type(expires) not in (int, float)
                or not stamp - LOOKBACK_SECONDS <= after <= stamp < expires <= stamp + 86400):
            return None
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return after


def fresh_run(home, run_id, country, now=None):
    return _manifest_after(home, run_id, country, now) is not None


def fresh_advert_ids(query, home, run_id, country, ids, now=None):
    after = _manifest_after(home, run_id, country, now)
    if after is None:
        return ids
    rows = query('select distinct l.advert_id from listings l join runs r on r.id=l.run_id '
                 'where r.country=? and r.started_at>=? and r.id<>?', ('uk', after, run_id))
    known = {str(row['advert_id']) for row in rows}
    return [aid for aid in ids if aid not in known]
