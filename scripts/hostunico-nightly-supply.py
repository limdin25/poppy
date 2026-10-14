"""Nightly SpareRoom supply for Pedro (Hugo, 2026-10-14).

Runs on the scraper VPS (margarita-server) at 05:30 London, Monday to
Saturday, from root's crontab. Reuses the existing pieces, it is not a new
scraper:
  * the SpareRoom Leads app at /opt/spareroom scrapes each city search
    (signed in, so phone numbers show), exactly like the 1 Oct city run,
  * hostunico-city-supply.py screens every advert (whole property, live
    price, real photo, outside London) and imports it through the CRM's strict
    phone door, so a number the CRM already knows is never added again.
Cities, searches, the nightly cap and the target live in the CRM setting
platform_settings 'hostunico_morning_leads'. Reports are prepared by the CRM's
/api/cron/hostunico-morning-leads passes, which run every 15 minutes until
10:00. Nothing here calls, texts or emails anybody.

The result goes into hostunico_morning_runs.vps for the day. If SpareRoom no
longer shows phone numbers (the saved login stopped working), the row says
session 'expired' and the morning pass marks the day BLOCKED for Hugo.
"""
import argparse
import csv
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import urllib.parse
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

HOME = Path('/opt/spareroom')
OPS = HOME / 'ops'
APP = 'http://127.0.0.1:8795'
LABEL = 'Pedro nightly %s - %s'

_spec = importlib.util.spec_from_file_location('city_supply', Path(__file__).with_name('hostunico-city-supply.py'))
S = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S)


def london_day(now=None):
    return datetime.fromtimestamp(time.time() if now is None else now, ZoneInfo('Europe/London')).strftime('%Y-%m-%d')


def nightly_settings(raw):
    value = json.loads(raw) if raw else {}
    cities = [c for c in value.get('cities', []) if isinstance(c, dict) and isinstance(c.get('name'), str)
              and isinstance(c.get('searches'), list) and all(re.fullmatch(r'\d{6,12}', str(s)) for s in c['searches'])]
    sizes = frozenset(str(x) for x in value.get('sizes', ['studio', '1', '2', '3'])) & S.ALLOWED_SIZES
    cap = value.get('max_new_listings', 150)
    target = value.get('target_ready', 150)
    return {'enabled': value.get('enabled', True) is not False, 'cities': cities, 'sizes': sizes or S.ALLOWED_SIZES,
            'max_new_listings': cap if isinstance(cap, int) and 0 <= cap <= 1000 else 150,
            'target_ready': target if isinstance(target, int) and 0 <= target <= 1000 else 150}


def contacts_needed(counts, settings):
    """New contacts worth importing tonight. About two in three researched homes
    clear the 30% uplift, so ask for half as many again as the gap."""
    gap = settings['target_ready'] - counts.get('ready', 0) - counts.get('held_waiting_report', 0)
    return max(0, -(-gap * 3 // 2))


def session_state(runs):
    """'expired' when SpareRoom refused the saved login, or finished searches
    found adverts but not one phone number."""
    if any(r['status'] == 'error' and 'sign-in failed' in (r.get('message') or '') for r in runs):
        return 'expired'
    done = [r for r in runs if r['status'] == 'done']
    if not done or sum(r['total'] for r in done) == 0:
        return 'unknown'
    return 'ok' if sum(r['with_phone'] for r in done) else 'expired'


class Scraper:
    def __init__(self, key):
        self.key = key

    def create_run(self, url, label):
        req = urllib.request.Request(APP + '/api/runs', method='POST', data=json.dumps(
            {'url': url, 'label': label, 'settings': {'threads': 3, 'retries': 3, 'timeout': 30}}).encode(), headers={
            'Content-Type': 'application/json', 'X-Requested-With': 'SpareRoomLeads', 'Cookie': 'sr_key=' + self.key})
        with urllib.request.urlopen(req, timeout=30) as r:
            value = json.loads(r.read())
        if not value.get('ok'):
            raise RuntimeError('Scraper refused the run')
        return value['id']


def read_runs(day):
    db = sqlite3.connect('file:%s?mode=ro' % (HOME / 'data/spareroom.db'), uri=True)
    db.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in db.execute('select id,status,label,file_name,total,with_phone,message from runs where label like ? order by id',
                                            (LABEL % (day, '') + '%',))]
    finally:
        db.close()


def write_fresh_manifest(run_ids, now=None):
    # Adverts already saved in the last 13 days were screened by an earlier
    # run, so the scraper skips re-exporting them (hostunico_fresh_exports).
    now = time.time() if now is None else now
    path = OPS / 'fresh-export-runs.json'
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps({'run_ids': run_ids, 'verified_after': now - 13 * 86400, 'expires_at': now + 20 * 3600}))
    os.chmod(tmp, 0o644)
    tmp.replace(path)


def record(api, day, vps, added_contacts=0, added_listings=0):
    api.db('hostunico_morning_runs', {'on_conflict': 'run_date'}, body={'run_date': day}, ignore=True)
    row = api.db('hostunico_morning_runs', {'select': 'added_contacts,added_listings', 'run_date': 'eq.' + day})[0]
    patch = {'vps': vps, 'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    if added_contacts or added_listings:
        patch.update(added_contacts=row['added_contacts'] + added_contacts, added_listings=row['added_listings'] + added_listings)
    if vps.get('session') == 'expired':
        patch.update(level='blocked', note='SpareRoom session on the VPS has expired. Hugo needs to sign the scraper back in at spareroom.heyelsie.com.')
    api.db('hostunico_morning_runs', {'run_date': 'eq.' + day}, body=patch, method='PATCH')
    return row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--hours', type=float, default=3.5, help='Stop importing after this long')
    parser.add_argument('--dry-run', action='store_true', help='Read the setting and counts only')
    args = parser.parse_args()
    os.umask(0o077)
    started = time.time()
    day = london_day(started)
    token = json.loads((OPS / 'report-token.json').read_text())['HOSTUNICO_CRM_TOKEN']
    api = S.Api(S.read_env('/root/elsie-assign/.env'), token)
    rows = api.db('platform_settings', {'select': 'value', 'key': 'eq.hostunico_morning_leads'})
    settings = nightly_settings(rows[0]['value'] if rows else None)
    counts = api.db('rpc/wk_hostunico_morning_counts', body={})
    need = contacts_needed(counts, settings)
    vps = {'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(started)), 'counts_before': counts,
           'contacts_needed': need, 'cities': len(settings['cities']), 'automatic_messages': 0}
    if args.dry_run:
        print(json.dumps(vps))
        return
    if not settings['enabled'] or not settings['cities']:
        record(api, day, {**vps, 'status': 'disabled'})
        return
    row = record(api, day, {**vps, 'status': 'checking'})
    room = settings['max_new_listings'] - row['added_listings']
    if need == 0 or room <= 0:
        record(api, day, {**vps, 'status': 'enough stock' if need == 0 else 'nightly cap reached'})
        return
    owner = api.db('profiles', {'select': 'id', 'email': 'eq.pedro@hostunico.com'})[0]['id']
    stage = api.db('wk_pipeline_columns', {'select': 'id', 'pipeline_id': 'eq.' + S.PIPELINE, 'name': 'eq.New lead'})[0]['id']
    if api.db('wk_dialer_campaigns', {'select': 'desk', 'id': 'eq.' + S.CAMPAIGN})[0]['desk'] != 'sa':
        raise RuntimeError('Wrong calling campaign')

    # 1. One scrape per city search, once a day. A re-run the same day carries on.
    runs = read_runs(day)
    if not runs:
        scraper = Scraper(S.read_env(HOME / 'data/.env')['SPAREROOM_ACCESS_KEY'])
        ids = []
        for city in settings['cities']:
            for n, search in enumerate(city['searches']):
                ids.append(scraper.create_run('https://www.spareroom.co.uk/flatshare/?search_id=%s&mode=list' % search,
                                              LABEL % (day, city['name'] + ('' if n == 0 else ' (%d)' % (n + 1)))))
        write_fresh_manifest(ids)
        runs = read_runs(day)

    # 2. Screen and import each finished search as it lands.
    state_file = OPS / ('nightly-state-%s.json' % day)
    state = json.loads(state_file.read_text()) if state_file.exists() else {
        'checked': {}, 'contacts': {}, 'properties': [], 'rejections': {}, 'new_contacts': 0, 'new_properties': 0}
    source_dir = OPS / 'sources'
    source_dir.mkdir(exist_ok=True)
    batch = 'uk-nightly-' + day
    deadline = started + args.hours * 3600
    added_contacts = added_listings = 0
    summary = {**vps, 'status': 'importing', 'runs': len(runs)}
    while time.time() < deadline:
        runs = read_runs(day)
        candidates = {}
        for run in runs:
            if run['status'] != 'done' or not run['file_name']:
                continue
            with open(HOME / 'results' / run['file_name'], encoding='utf-8-sig') as f:
                for item in csv.DictReader(f):
                    aid = re.search(r'flatshare_id=(\d+)', item.get('Link', ''))
                    if aid and item.get('Number', '').strip():
                        candidates.setdefault(aid[1], item)
        for aid, item in candidates.items():
            if aid in state['checked']:
                continue
            if state['new_contacts'] >= need or state['new_properties'] >= room:
                break
            try:
                path = source_dir / (aid + '.html')
                if not path.exists():
                    with urllib.request.urlopen(urllib.request.Request(item['Link'], headers={'User-Agent': 'Mozilla/5.0'}), timeout=25) as r:
                        path.write_text(r.read().decode('utf-8', errors='replace'))
                screened = S.screen_city_advert(item, path.read_text(), settings['sizes'])
                with urllib.request.urlopen(urllib.request.Request(screened['photos'][0], method='HEAD'), timeout=15) as r:
                    if not r.headers.get('Content-Type', '').startswith('image/'):
                        raise S.Rejected('actual_photo_not_available')
                cid, lid, new_contact, new_property = S.import_property(api, screened, owner, stage, batch)
                state['contacts'].setdefault(cid, lid)
                state['properties'].append(lid)
                state['new_contacts'] += int(new_contact)
                state['new_properties'] += int(new_property)
                added_contacts += int(new_contact)
                added_listings += int(new_property)
                state['checked'][aid] = 'imported'
                (source_dir / (aid + '.txt')).write_text(screened['text'])
            except S.Rejected as e:
                state['checked'][aid] = str(e)
                state['rejections'][str(e)] = state['rejections'].get(str(e), 0) + 1
            except Exception as e:
                print(json.dumps({'event': 'retry_later', 'advert_id': aid, 'error_type': type(e).__name__}), flush=True)
            tmp = state_file.with_suffix('.tmp')
            tmp.write_text(json.dumps(state))
            tmp.replace(state_file)
            time.sleep(.4)
        session = session_state(runs)
        finished = all(r['status'] not in ('queued', 'running') for r in runs)
        summary = {**vps, 'status': 'importing', 'session': session, 'runs': len(runs),
                   'runs_done': sum(r['status'] == 'done' for r in runs), 'adverts_found': len(candidates),
                   'adverts_checked': len(state['checked']), 'new_contacts': state['new_contacts'],
                   'new_listings': state['new_properties'], 'rejections': state['rejections']}
        record(api, day, summary, added_contacts, added_listings)
        added_contacts = added_listings = 0
        if session == 'expired' or finished or state['new_contacts'] >= need or state['new_properties'] >= room:
            break
        time.sleep(60)
    record(api, day, {**summary, 'status': 'done', 'finished_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
