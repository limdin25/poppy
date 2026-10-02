"""Opt-in export acceleration for a bounded human-requested fresh supply run.

Known adverts remain in their original CSV exports. This only saves duplicate
network requests within 24 hours, never changes records or sends messages.
"""
import json
from pathlib import Path
import time


def fresh_advert_ids(query, home, run_id, country, ids, now=None):
    stamp = time.time() if now is None else now
    path = Path(home) / 'ops/fresh-export-runs.json'
    if country != 'uk' or not path.exists():
        return ids
    try:
        config = json.loads(path.read_text())
        runs = config['run_ids']
        after, expires = config['verified_after'], config['expires_at']
        if (not isinstance(runs, list) or not runs or any(type(x) is not int or x <= 0 for x in runs)
                or run_id not in runs or type(after) not in (int, float) or type(expires) not in (int, float)
                or not stamp - 86400 <= after <= stamp < expires <= stamp + 86400):
            return ids
    except (OSError, ValueError, KeyError, TypeError):
        return ids
    rows = query('select distinct l.advert_id from listings l join runs r on r.id=l.run_id '
                 'where r.country=? and r.started_at>=? and r.id<>?', ('uk', after, run_id))
    known = {str(row['advert_id']) for row in rows}
    return [aid for aid in ids if aid not in known]
