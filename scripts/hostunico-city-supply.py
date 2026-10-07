"""Human-requested city import. Only report start/status and CRM records are written.

There is no calling or messaging path. The database's existing uplift triggers
control qualification. Existing queue rows and call history are never reset.
"""
import argparse
import collections
from decimal import Decimal, ROUND_HALF_UP
import fcntl
from functools import lru_cache
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
LONDON_PREFIXES = {'E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC'}
LONDON_BORDER_PREFIXES = {'HA', 'UB', 'IG', 'RM', 'SM', 'CR', 'BR', 'KT', 'TW', 'EN'}
# Verified against the 33 council options on London Councils on 2 October 2026:
# https://www.londoncouncils.gov.uk/local-elections-2026-results
LONDON_COUNCILS = {
    'barking and dagenham', 'barnet', 'bexley', 'brent', 'bromley', 'camden',
    'city of london', 'croydon', 'ealing', 'enfield', 'greenwich', 'hackney',
    'hammersmith and fulham', 'haringey', 'harrow', 'havering', 'hillingdon',
    'hounslow', 'islington', 'kensington and chelsea', 'kingston upon thames',
    'lambeth', 'lewisham', 'merton', 'newham', 'redbridge', 'richmond upon thames',
    'southwark', 'sutton', 'tower hamlets', 'waltham forest', 'wandsworth', 'westminster',
}


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


def advert_outcode(page):
    out = re.search(r',\s*([A-Z]{1,2}\d[A-Z\d]?)\s*:', page.meta.get('description', ''), re.I)
    if not out:
        out = re.search(r'\(([A-Z]{1,2}\d[A-Z\d]?)\)', page.text())
    if not out:
        raise Rejected('missing_postcode_area')
    return out[1].upper()


def outside_london(outcode, evidence):
    if not isinstance(evidence, dict) or evidence.get('outcode') != outcode:
        return False
    councils = evidence.get('admin_district')
    if not isinstance(councils, list) or not councils or any(not isinstance(x, str) or not x.strip() for x in councils):
        return False
    names = {' '.join(x.replace('&', 'and').lower().split()) for x in councils}
    # A mixed outcode remains excluded. A town name cannot establish which side
    # of a London boundary the actual property is on.
    return not (names & LONDON_COUNCILS)


@lru_cache(maxsize=256)
def lookup_outcode_councils(outcode):
    # Official aggregated council data, documented at:
    # https://postcodes.io/docs/api/find-outcode
    req = urllib.request.Request('https://api.postcodes.io/outcodes/' + urllib.parse.quote(outcode),
                                 headers={'User-Agent': 'Hostunico verified property import'})
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    return data.get('result') if data.get('status') == 200 else None


def screen_city_advert(row, source):
    page = Visible()
    page.feed(source)
    outcode = advert_outcode(page)
    # Postal areas cross council boundaries, including DA and WD. Verify every
    # actual outcode instead of assuming a prefix list covers Greater London.
    evidence = lookup_outcode_councils(outcode)
    if not outside_london(outcode, evidence):
        raise Rejected('london_or_london_border')
    return screen(row, source, evidence)


def screen(row, source, council_evidence=None):
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
    title = row.get('Name', '')
    ensuite_bedroom = re.search(r'\ben[- ]?suite\s+(?:(?:single|double)\s+)?bedroom\b', title, re.I)
    names_whole_home = re.search(r'\b(?:studio|flat|apartment)\b', title, re.I)
    if re.search(r'\broom\b|house\s*share', title, re.I) or (ensuite_bedroom and not names_whole_home):
        raise Rejected('room_title')
    page = Visible()
    page.feed(source)
    text = page.text()
    before_availability = text.split('\nAvailability\n')[0]
    if re.search(r'\bphotos?\s+show\s+(?:a\s+)?(?:variety|variaty)\s+of\s+(?:different\s+)?(?:rooms|properties|units)\b', before_availability, re.I):
        raise Rejected('generic_listing_photos')
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
    outcode = advert_outcode(page)
    prefix = re.match(r'[A-Z]+', outcode)[0]
    if prefix in LONDON_PREFIXES or (prefix in LONDON_BORDER_PREFIXES and not outside_london(outcode, council_evidence)):
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
            # Only the Postgres error code is kept, never the message or the request.
            try:
                code = json.loads(e.read()).get('code')
            except Exception:
                code = None
            code = code if isinstance(code, str) and re.fullmatch(r'[0-9A-Z]{5}', code) else None
            raise RuntimeError('CRM ' + table.split('/')[0] + ' HTTP ' + str(e.code) +
                               (' code ' + code if code else '')) from None

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


def ingest(api, contact):
    # The CRM phone rule (one person per number, 30 day cooldown, permanent
    # do not contact) answers with these codes. Both are final for this lead.
    try:
        return api.db('rpc/wk_ingest_contacts', body={'p_contacts': contact})
    except RuntimeError as e:
        if str(e).endswith(' code 23514'):
            raise Rejected('phone_suppressed_or_in_cooldown') from None
        if str(e).endswith(' code 22023'):
            raise Rejected('invalid_number') from None
        raise


def import_property(api, item, owner, stage, batch=BATCH):
    listing = api.db('sa_listings', {'select': 'id,wk_contact_id,rent_pcm,source_price,photo_urls,report_property,hostunico_call_eligible',
                                   'rightmove_id': 'eq.spareroom:' + item['advert_id']})
    existing = api.db('wk_contacts', {'select': 'id,desk,owner_agent_id,do_not_call',
                                     'or': '(phone.eq.' + item['phone'] + ',hostunico_sms_phone.eq.' + item['phone'] + ')'})
    if existing and not listing:
        ingest(api, {
            'name': item['name'], 'phone': item['phone'], 'desk': 'sa', 'owner_agent_id': owner,
            'custom_fields': {'listing_url': item['url'], 'property_address': item['title'],
                              'source': 'spareroom', 'source_batch': batch}})
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
        existing = ingest(api, {'name': item['name'], 'phone': item['phone'], 'desk': 'sa',
                           'owner_agent_id': owner, 'pipeline_column_id': stage, 'ai_enabled': False,
                           'custom_fields': {'lead_type': 'hostunico_owner', 'source': 'spareroom',
                                             'source_batch': batch, 'owner_name': item['name'],
                                             'advertiser_type': item['authority'], 'next_step': 'Offer the property report'}})
        if not existing:
            raise RuntimeError('CRM contact not returned')
        # The RPC hands back the one canonical contact for the number. If that
        # person already lives on another desk or with another agent, leave them.
        if existing[0].get('desk', 'sa') != 'sa' or existing[0].get('owner_agent_id', owner) != owner:
            raise Rejected('number_conflict_or_another_owner')
        if existing[0].get('do_not_call'):
            raise Rejected('contact_opted_out')
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
    # Checked for new contacts too: the RPC may have returned an existing person.
    history = [] if queue else api.db('wk_calls', {'select': 'id', 'contact_id': 'eq.' + contact_id, 'limit': '1'})
    if not queue and not history:
        api.db('wk_dialer_queue', body={'campaign_id': CAMPAIGN, 'contact_id': contact_id,
                                      'status': 'skipped', 'hostunico_uplift_hold': True,
                                      'priority': 100 if new_contact else 0})
    return contact_id, listing[0]['id'], new_contact, new_property


def sync_report(api, listing_id, create=True, refresh=True):
    rows = api.db('sa_property_reports', {'select': '*', 'listing_id': 'eq.' + listing_id})
    if rows and rows[0]['state'] == 'ready' and rows[0].get('report_pitch') and not rows[0]['report_pitch'].get('planning'):
        return True
    if not refresh:
        return False
    listing = api.db('sa_listings', {'select': 'id,report_property,address,listing_url,photo_urls,property_type,rent_pcm,source_price,hostunico_call_eligible', 'id': 'eq.' + listing_id})[0]
    if not rows and create:
        api.db('sa_property_reports', {'on_conflict': 'listing_id'}, body={
            'listing_id': listing_id, 'remote_id': str(uuid.uuid4()), 'access_token': secrets.token_hex(32),
            'property': listing['report_property']}, ignore=True)
        rows = api.db('sa_property_reports', {'select': '*', 'listing_id': 'eq.' + listing_id})
    if not rows:
        return False
    row = rows[0]
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
    refresh = True
    for listing_id in selected:
        try:
            if sync_report(api, listing_id, refresh=refresh):
                ready += 1
            else:
                waiting += 1
        except Exception as e:
            waiting += 1
            errors += 1
            status = re.search(r'HTTP (\d{3})\b', str(e))
            if status and int(status[1]) in (429, 502, 503, 504):
                # Keep imports moving during a shared service outage. The next
                # scheduled pass tries again with the same report identities.
                refresh = False
            print(json.dumps({'event': 'report_retry_later', 'listing_id': listing_id,
                              'error_type': type(e).__name__,
                              'http_status': int(status[1]) if status else None}), flush=True)
    return ready, waiting, errors


def supply_runs(db, ops, config_name='supply-runs.json'):
    config = ops / config_name
    ids = json.loads(config.read_text()) if config.exists() else list(range(10, 21))
    if not isinstance(ids, list) or not ids or any(type(x) is not int or x <= 0 for x in ids):
        raise ValueError('Supply run config must contain positive integer run IDs')
    slots = ','.join('?' for _ in ids)
    return db.execute('select id,label,location,status,file_name from runs where id in (' + slots + ') order by id', ids).fetchall()


def run_window_open(once, stop_at, now=None):
    # An explicitly requested one-pass run must not inherit yesterday's deadline.
    return once or (time.time() if now is None else now) < stop_at


def report_sync_due(last_sync, once, now=None, interval=900):
    return once or (time.time() if now is None else now) - last_sync >= interval


def report_listing_ids(state):
    # An agent may have several homes. Refresh each home so a later qualifying
    # property can release their one unique calling row.
    return list(dict.fromkeys(state.get('properties', []) + list(state.get('contacts', {}).values())))


def prepare_border_recheck(state):
    if state.get('london_boundary_rule_version') == 2:
        return
    retry = [aid for aid, reason in state['checked'].items() if reason == 'london_or_london_border']
    for aid in retry:
        del state['checked'][aid]
    state['rejections']['london_or_london_border'] = max(0, state['rejections'].get('london_or_london_border', 0) - len(retry))
    state['refresh_source_ids'] = list(dict.fromkeys(state.get('refresh_source_ids', []) + retry))
    state['london_boundary_rule_version'] = 2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', default='/opt/spareroom')
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--max-items', type=int, default=35)
    parser.add_argument('--stop-at', type=float, default=STOP_AT, help='Explicit UTC Unix deadline for a resumed persistent run')
    parser.add_argument('--report-sync-seconds', type=int, default=900, help='Status refresh interval for newly researched reports')
    parser.add_argument('--batch', default=BATCH, help='source_batch label written on new contacts')
    parser.add_argument('--state', default='supply-state.json', help='State file name inside ops/')
    parser.add_argument('--runs-file', default='supply-runs.json', help='Run ID config file name inside ops/')
    args = parser.parse_args()
    if not 60 <= args.report_sync_seconds <= 900:
        parser.error('Report refresh interval must be between 60 and 900 seconds')
    for name in (args.state, args.runs_file):
        if not re.fullmatch(r'[a-z0-9-]+\.json', name):
            parser.error('State and run files are plain names inside ops/')
    if not re.fullmatch(r'[a-z0-9-]+', args.batch):
        parser.error('Batch is a plain lowercase label')
    os.umask(0o077)
    home = Path(args.home)
    ops = home / 'ops'
    ops.mkdir(exist_ok=True)
    lock = open(ops / 'supply.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    state_file = ops / args.state
    state = json.loads(state_file.read_text()) if state_file.exists() else {
        'batch': args.batch, 'checked': {}, 'contacts': {}, 'properties': [], 'rejections': {}, 'new_contacts': 0, 'new_properties': 0}
    prepare_border_recheck(state)
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
    while run_window_open(args.once, args.stop_at):
        db = sqlite3.connect(home / 'data/spareroom.db')
        db.row_factory = sqlite3.Row
        runs = supply_runs(db, ops, args.runs_file)
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
                item = screen_city_advert(row, path.read_text())
                if aid in state.get('refresh_source_ids', []):
                    # Only a previously rejected property outside London reaches
                    # here. Verify the current page again before importing it.
                    req = urllib.request.Request(row['Link'], headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=25) as r:
                        source = r.read().decode('utf-8', errors='replace')
                    path.write_text(source)
                    item = screen_city_advert(row, source)
                photo = urllib.request.Request(item['photos'][0], method='HEAD')
                with urllib.request.urlopen(photo, timeout=15) as r:
                    if not r.headers.get('Content-Type', '').startswith('image/'):
                        raise Rejected('actual_photo_not_available')
                cid, lid, new_contact, new_property = import_property(api, item, owner, stage, args.batch)
                state['contacts'].setdefault(cid, lid)
                if lid not in state['properties']:
                    state['properties'].append(lid)
                state['new_contacts'] += int(new_contact)
                state['new_properties'] += int(new_property)
                state['checked'][aid] = 'imported'
                if aid in state.get('refresh_source_ids', []):
                    state['refresh_source_ids'].remove(aid)
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
        if report_sync_due(last_sync, args.once, interval=args.report_sync_seconds):
            selected = report_listing_ids(state)
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
