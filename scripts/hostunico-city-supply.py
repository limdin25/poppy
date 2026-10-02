"""Human-requested city import. Only report start/status and CRM records are written.

There is no calling or messaging path. The database's existing uplift triggers
control qualification. Existing queue rows and call history are never reset.
"""
import argparse
import collections
from decimal import Decimal, ROUND_HALF_UP
import fcntl
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import csv

CAMPAIGN = '5d9657f9-d9b4-4e27-a2d1-83db80867f92'
PIPELINE = 'dadce4ac-90b5-4320-9291-ff6bb1cf89f0'
BATCH = 'uk-cities-2026-10-01'
STOP_AT = 1790924400  # 2 October 2026, 07:00 UTC (08:00 London).


class Rejected(Exception):
    pass


class Visible(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.meta, self.hidden = [], {}, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('script', 'style'):
            self.hidden += 1
        if tag == 'meta':
            self.meta[a.get('name') or a.get('property') or ''] = a.get('content', '')
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'dt', 'dd', 'li', 'section', 'br'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'dt', 'dd', 'li', 'section'):
            self.parts.append('\n')

    def handle_data(self, text):
        if not self.hidden:
            self.parts.append(text)

    def text(self):
        return '\n'.join(' '.join(x.split()) for x in ''.join(self.parts).splitlines() if x.strip())


def phone(value):
    d = re.sub(r'[^0-9+]', '', str(value or ''))
    if d.startswith('+44'):
        d = d[3:]
    elif d.startswith('0044'):
        d = d[4:]
    elif d.startswith('44') and len(d) == 12:
        d = d[2:]
    elif d.startswith('0'):
        d = d[1:]
    else:
        return ''
    d = d.lstrip('0')
    return '+44' + d if re.fullmatch(r'[1-9][0-9]{8,9}', d) else ''


def rent(value):
    m = re.fullmatch(r'£?([0-9]+(?:\.[0-9]{1,2})?)\s*(pcm|pw)', str(value).replace(',', '').strip(), re.I)
    if not m or Decimal(m[1]) <= 0:
        raise Rejected('missing_or_ambiguous_price')
    amount = Decimal(m[1])
    monthly = amount * Decimal(52) / Decimal(12) if m[2].lower() == 'pw' else amount
    return monthly.quantize(Decimal('.01'), rounding=ROUND_HALF_UP), '£' + m[1] + ' ' + m[2].lower()


def screen(row, source):
    number = phone(row.get('Number'))
    if not number:
        raise Rejected('invalid_number')
    u = urllib.parse.urlparse(row.get('Link', ''))
    aid = (urllib.parse.parse_qs(u.query).get('flatshare_id') or [''])[0]
    if u.scheme != 'https' or u.hostname not in ('www.spareroom.co.uk', 'spareroom.co.uk') or not aid.isdigit():
        raise Rejected('invalid_listing_link')
    authority = row.get('AgentType', '').lower()
    if not re.search(r'landlord|agent', authority) or re.search(r'flatmate|tenant', authority):
        raise Rejected('authority_not_established')
    section = re.search(r'<section\b[^>]*class=["\'][^"\']*feature--price-whole-property[^"\']*["\'][^>]*>(.*?)</section>', source, re.I | re.S)
    if not section:
        raise Rejected('not_a_whole_property')
    part = Visible()
    part.feed(section[1])
    property_text = part.text()
    studio = bool(re.search(r'This ad is for a Studio flat\b', property_text, re.I))
    one_bed = bool(re.search(r'This ad is for a 1 bed (?:flat|apartment)\b', property_text, re.I))
    if not studio and not one_bed:
        raise Rejected('not_a_studio_or_one_bed_flat')
    if re.search(r'\broom\b|house\s*share', row.get('Name', ''), re.I):
        raise Rejected('room_title')
    page = Visible()
    page.feed(source)
    text = page.text()
    before_availability = text.split('\nAvailability\n')[0]
    affirmative = '\n'.join(x for x in re.split(r'[.\n]+', before_availability)
                            if not re.search(r'\b(not|unlike|without|no shared)\b|than (?:a |the )?(?:conventional|traditional) house share', x, re.I))
    if re.search(r'shared (?:kitchen|bathroom|student|flat|house)|sharing (?:their|a|the|our|your)?\s*(?:own )?(?:communal )?(?:kitchen|bathroom)|(?:ensuite|en-suite) room|room (?:in a|remaining)|house\s*share', affirmative, re.I):
        raise Rejected('shared_facilities')
    price = re.search(r'£\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(pcm|pw)\b', property_text, re.I)
    if not price:
        raise Rejected('no_live_whole_property_price')
    monthly, source_price = rent(price[1] + price[2])
    scraped_monthly, _ = rent(row.get('Price', ''))
    if monthly != scraped_monthly:
        raise Rejected('price_mismatch')
    out = re.search(r',\s*([A-Z]{1,2}\d[A-Z\d]?)\s*:', page.meta.get('description', ''), re.I)
    if not out:
        out = re.search(r'\(([A-Z]{1,2}\d[A-Z\d]?)\)', text)
    if not out:
        raise Rejected('missing_postcode_area')
    outcode = out[1].upper()
    prefix = re.match(r'[A-Z]+', outcode)[0]
    if prefix in {'E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC', 'HA', 'UB', 'IG', 'RM', 'SM', 'CR', 'BR', 'KT', 'TW', 'EN'}:
        raise Rejected('london_or_london_border')
    photos = list(dict.fromkeys(re.findall(r'(?:href|data-src)=["\'](https://photos[12]?\.spareroom\.co\.uk/images/flatshare/listings/large/[\d/]+\.(?:jpg|jpeg|png|webp))["\']', source, re.I)))[:12]
    if not photos:
        raise Rejected('missing_actual_advert_photo')
    name = (row.get('Company Name') or row.get('Advertiser Name') or 'SpareRoom advertiser').strip()
    return {'advert_id': aid, 'phone': number, 'name': name, 'title': row['Name'].strip(),
            'location': row.get('Location', '').strip(), 'outcode': outcode,
            'rent_pcm': float(monthly), 'source_price': source_price, 'studio': studio,
            'photos': photos, 'url': row['Link'], 'authority': authority, 'text': text}


def read_env(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            result[k.strip()] = v.strip().strip('"').strip("'")
    return result


class Api:
    def __init__(self, env, token):
        self.origin = env['SUPABASE_URL'].rstrip('/')
        if self.origin != 'https://loggyxryrhqsbtqpteog.supabase.co':
            raise RuntimeError('Wrong CRM database')
        self.key, self.token = env['SUPABASE_SERVICE_ROLE_KEY'], token

    def db(self, table, query=None, body=None, method=None, ignore=False):
        url = self.origin + '/rest/v1/' + table
        if query:
            url += '?' + urllib.parse.urlencode(query)
        headers = {'apikey': self.key, 'Authorization': 'Bearer ' + self.key, 'Content-Type': 'application/json',
                   'Prefer': 'return=representation' + (',resolution=ignore-duplicates' if ignore else '')}
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                     headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                data = r.read()
            return json.loads(data) if data else None
        except urllib.error.HTTPError as e:
            raise RuntimeError('CRM ' + table.split('/')[0] + ' HTTP ' + str(e.code)) from None

    def report(self, action, data):
        assert action in ('start', 'status')
        req = urllib.request.Request('https://hostunico.com/api/hostunico/crm-estimates/' + action,
                                     data=json.dumps(data).encode(), headers={
                                         'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise RuntimeError('Report ' + action + ' HTTP ' + str(e.code)) from None


def import_property(api, item, owner, stage):
    listing = api.db('sa_listings', {'select': 'id,wk_contact_id,rent_pcm,source_price,photo_urls,report_property,hostunico_call_eligible',
                                   'rightmove_id': 'eq.spareroom:' + item['advert_id']})
    existing = api.db('wk_contacts', {'select': 'id,desk,owner_agent_id,do_not_call',
                                     'or': '(phone.eq.' + item['phone'] + ',hostunico_sms_phone.eq.' + item['phone'] + ')'})
    if len(existing) > 1 or any(x['desk'] != 'sa' or x['owner_agent_id'] != owner for x in existing):
        raise Rejected('number_conflict_or_another_owner')
    new_contact = not existing
    if existing and existing[0]['do_not_call']:
        raise Rejected('contact_opted_out')
    if listing and (not existing or listing[0]['wk_contact_id'] != existing[0]['id']):
        raise Rejected('listing_contact_conflict')
    if listing and Decimal(str(listing[0]['rent_pcm'])) != Decimal(str(item['rent_pcm'])):
        raise Rejected('existing_listing_price_changed')
    if not existing:
        existing = api.db('wk_contacts', body={'name': item['name'], 'phone': item['phone'], 'desk': 'sa',
                           'owner_agent_id': owner, 'pipeline_column_id': stage, 'ai_enabled': False,
                           'custom_fields': {'lead_type': 'hostunico_owner', 'source': 'spareroom',
                                             'source_batch': BATCH, 'owner_name': item['name'],
                                             'advertiser_type': item['authority'], 'next_step': 'Offer the property report'}})
    contact_id = existing[0]['id']
    new_property = not listing
    if not listing:
        property_data = {'postcode': item['outcode'], 'areaLabel': item['location'], 'bedrooms': 1,
                         'bathrooms': 1, 'wholeProperty': True, 'areaEstimate': True,
                         'advertisedRentPcm': item['rent_pcm']}
        listing = api.db('sa_listings', body={
            'rightmove_id': 'spareroom:' + item['advert_id'], 'source': 'spareroom', 'agency': item['name'],
            'agency_phone': item['phone'], 'wk_contact_id': contact_id, 'address': item['title'],
            'city': item['location'], 'outcode': item['outcode'], 'rent_pcm': item['rent_pcm'],
            'source_price': item['source_price'], 'bedrooms': None if item['studio'] else 1, 'bathrooms': None,
            'property_type': 'Studio' if item['studio'] else 'Flat', 'photo_urls': item['photos'],
            'listing_url': item['url'], 'report_property': property_data, 'hostunico_call_eligible': True,
            'hostunico_eligibility_note': 'Live whole studio/one-bedroom flat, asking price and actual photo verified.',
            'summary': 'Whole flat verified from the live advert. Confirm availability, authority, full postcode and bathroom count. Area report assumptions are unconfirmed.',
            'dealt_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
    else:
        # Earlier imports can lack source evidence. Repair missing fields using
        # this verified live page, while preserving confirmed property inputs.
        patch = {}
        if not listing[0].get('photo_urls'):
            patch['photo_urls'] = item['photos']
        if not listing[0].get('report_property'):
            patch['report_property'] = {'postcode': item['outcode'], 'areaLabel': item['location'],
                                        'bedrooms': 1, 'bathrooms': 1, 'wholeProperty': True,
                                        'areaEstimate': True, 'advertisedRentPcm': item['rent_pcm']}
        if not listing[0].get('hostunico_call_eligible'):
            patch['hostunico_call_eligible'] = True
            patch['hostunico_eligibility_note'] = 'Live whole studio/one-bedroom flat, asking price and actual photo verified.'
        if patch:
            api.db('sa_listings', {'id': 'eq.' + listing[0]['id']}, body=patch, method='PATCH')
    # Preserve every existing queue row, including skipped, missed and done.
    queue = api.db('wk_dialer_queue', {'select': 'id', 'campaign_id': 'eq.' + CAMPAIGN,
                                     'contact_id': 'eq.' + contact_id})
    history = [] if new_contact or queue else api.db('wk_calls', {'select': 'id', 'contact_id': 'eq.' + contact_id, 'limit': '1'})
    if not queue and not history:
        api.db('wk_dialer_queue', body={'campaign_id': CAMPAIGN, 'contact_id': contact_id,
                                      'status': 'skipped', 'hostunico_uplift_hold': True,
                                      'priority': 100 if new_contact else 0})
    return contact_id, listing[0]['id'], new_contact, new_property


def sync_report(api, listing_id, create=True):
    listing = api.db('sa_listings', {'select': 'id,report_property,address,listing_url,photo_urls,property_type,rent_pcm,source_price,hostunico_call_eligible', 'id': 'eq.' + listing_id})[0]
    rows = api.db('sa_property_reports', {'select': '*', 'listing_id': 'eq.' + listing_id})
    if not rows and create:
        api.db('sa_property_reports', {'on_conflict': 'listing_id'}, body={
            'listing_id': listing_id, 'remote_id': str(uuid.uuid4()), 'access_token': secrets.token_hex(32),
            'property': listing['report_property']}, ignore=True)
        rows = api.db('sa_property_reports', {'select': '*', 'listing_id': 'eq.' + listing_id})
    if not rows:
        return False
    row = rows[0]
    if row['state'] == 'ready' and row.get('report_pitch') and not row['report_pitch'].get('planning'):
        return True
    payload = {'id': row['remote_id'], 'token': row['access_token'], 'country': 'GB',
               'listing': {'title': listing['address'], 'photo': listing['photo_urls'][0],
                           'url': listing['listing_url'], 'propertyType': listing['property_type'],
                           'advertisedRentPcm': listing['rent_pcm'], 'sourcePrice': listing['source_price'],
                           'wholePropertyVerified': listing['hostunico_call_eligible']}}
    # A stable CRM id is reused on every request, including after a restart.
    action = 'status' if row.get('report_url') else 'start'
    if action == 'start':
        payload['property'] = row['property']
    value = api.report(action, payload)
    if value.get('stage') not in ('queued', 'researching', 'ready', 'review', 'needs_photo'):
        raise RuntimeError('Unexpected report stage')
    api.db('sa_property_reports', {'listing_id': 'eq.' + listing_id, 'remote_id': 'eq.' + row['remote_id']},
           body={'state': value['stage'], 'message': value.get('message'), 'report_url': value.get('reportUrl'),
                 'report_pitch': value.get('reportPitch') if value['stage'] == 'ready' else None,
                 'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, method='PATCH')
    return value['stage'] == 'ready' and bool(value.get('reportPitch')) and not value['reportPitch'].get('planning')


def sync_reports(api, selected):
    ready, waiting, errors = 0, 0, 0
    for listing_id in selected:
        try:
            if sync_report(api, listing_id):
                ready += 1
            else:
                waiting += 1
        except Exception as e:
            waiting += 1
            errors += 1
            status = re.search(r'HTTP (\d{3})\b', str(e))
            print(json.dumps({'event': 'report_retry_later', 'listing_id': listing_id,
                              'error_type': type(e).__name__,
                              'http_status': int(status[1]) if status else None}), flush=True)
    return ready, waiting, errors


def supply_runs(db, ops):
    config = ops / 'supply-runs.json'
    ids = json.loads(config.read_text()) if config.exists() else list(range(10, 21))
    if not isinstance(ids, list) or not ids or any(type(x) is not int or x <= 0 for x in ids):
        raise ValueError('Supply run config must contain positive integer run IDs')
    slots = ','.join('?' for _ in ids)
    return db.execute('select id,label,location,status,file_name from runs where id in (' + slots + ') order by id', ids).fetchall()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', default='/opt/spareroom')
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--max-items', type=int, default=35)
    args = parser.parse_args()
    os.umask(0o077)
    home = Path(args.home)
    ops = home / 'ops'
    ops.mkdir(exist_ok=True)
    lock = open(ops / 'supply.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    state_file = ops / 'supply-state.json'
    state = json.loads(state_file.read_text()) if state_file.exists() else {
        'batch': BATCH, 'checked': {}, 'contacts': {}, 'properties': [], 'rejections': {}, 'new_contacts': 0, 'new_properties': 0}
    def save_state():
        temporary = state_file.with_suffix('.tmp')
        temporary.write_text(json.dumps(state))
        temporary.replace(state_file)
    token = json.loads((ops / 'report-token.json').read_text())['HOSTUNICO_CRM_TOKEN']
    api = Api(read_env('/root/elsie-assign/.env'), token)
    owner = api.db('profiles', {'select': 'id', 'email': 'eq.pedro@hostunico.com'})[0]['id']
    stage = api.db('wk_pipeline_columns', {'select': 'id', 'pipeline_id': 'eq.' + PIPELINE, 'name': 'eq.New lead'})[0]['id']
    if api.db('wk_dialer_campaigns', {'select': 'desk', 'id': 'eq.' + CAMPAIGN})[0]['desk'] != 'sa':
        raise RuntimeError('Wrong calling campaign')
    source_dir = ops / 'sources'
    source_dir.mkdir(exist_ok=True)
    last_sync = 0
    while time.time() < STOP_AT:
        db = sqlite3.connect(home / 'data/spareroom.db')
        db.row_factory = sqlite3.Row
        runs = supply_runs(db, ops)
        db.close()
        candidates = {}
        for run in runs:
            if not run['label'].startswith('Pedro tomorrow - ') or not run['file_name']:
                continue
            with open(home / 'results' / run['file_name'], encoding='utf-8-sig') as f:
                for row in csv.DictReader(f):
                    if not row.get('Number', '').strip():
                        continue
                    aid = re.search(r'flatshare_id=(\d+)', row.get('Link', ''))
                    if aid:
                        candidates.setdefault(aid[1], row)
        work = [(aid, row) for aid, row in candidates.items() if aid not in state['checked']][:args.max_items]
        for aid, row in work:
            try:
                path = source_dir / (aid + '.html')
                if not path.exists():
                    req = urllib.request.Request(row['Link'], headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=25) as r:
                        source = r.read().decode('utf-8', errors='replace')
                    path.write_text(source)
                item = screen(row, path.read_text())
                photo = urllib.request.Request(item['photos'][0], method='HEAD')
                with urllib.request.urlopen(photo, timeout=15) as r:
                    if not r.headers.get('Content-Type', '').startswith('image/'):
                        raise Rejected('actual_photo_not_available')
                cid, lid, new_contact, new_property = import_property(api, item, owner, stage)
                state['contacts'].setdefault(cid, lid)
                if lid not in state['properties']:
                    state['properties'].append(lid)
                state['new_contacts'] += int(new_contact)
                state['new_properties'] += int(new_property)
                state['checked'][aid] = 'imported'
                # Keep the verified source alongside the public page for review.
                (source_dir / (aid + '.txt')).write_text(item['text'])
            except Rejected as e:
                state['checked'][aid] = str(e)
                state['rejections'][str(e)] = state['rejections'].get(str(e), 0) + 1
            except Exception as e:
                # A network/service failure stays retryable. Do not invent a price or eligibility.
                print(json.dumps({'event': 'retry_later', 'advert_id': aid, 'error_type': type(e).__name__}), flush=True)
            save_state()
            time.sleep(.4)
        if time.time() - last_sync > 900 or args.once:
            selected = list(dict.fromkeys(state['contacts'].values()))
            ready, waiting, errors = sync_reports(api, selected)
            state['last_report_sync'] = time.time()
            state['researched_reports'] = ready
            state['waiting_reports'] = waiting
            state['report_errors'] = errors
            last_sync = time.time()
            save_state()
        print(json.dumps({'event': 'progress', 'runs_done': sum(r['status'] == 'done' for r in runs),
                          'runs_total': len(runs), 'numbered_adverts_found': len(candidates),
                          'adverts_checked': len(state['checked']), 'suitable_unique_contacts': len(state['contacts']),
                          'new_contacts': state['new_contacts'], 'new_properties': state['new_properties'],
                          'researched_reports': state.get('researched_reports', 0),
                          'waiting_reports': state.get('waiting_reports', 0),
                          'report_errors': state.get('report_errors', 0),
                          'rejections': state['rejections'], 'automatic_messages': 0}), flush=True)
        if args.once:
            break
        time.sleep(90)


if __name__ == '__main__':
    main()
