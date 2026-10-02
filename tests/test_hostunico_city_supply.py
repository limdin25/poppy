import importlib.util
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('city_supply', Path(__file__).parents[1] / 'scripts/hostunico-city-supply.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def advert(price='650 pcm', kind='Studio flat', description='Self-contained with its own kitchen and bathroom.'):
    return f'''<meta name="description" content="Flat for rent in Leeds, LS1: A flat">
    <h1>City centre studio</h1><section class="feature feature--price-whole-property">
    <h3>&pound;{price}<small>(whole property)</small></h3><p>This ad is for a {kind}</p></section>
    <div>{description}</div><section><h3>Availability</h3></section>
    <a href="https://photos2.spareroom.co.uk/images/flatshare/listings/large/10/17/101721149.jpg">Photo</a>'''


class ScreeningTests(unittest.TestCase):
    def row(self, **changes):
        return {'Name': 'City centre studio', 'Price': '650pcm', 'Number': '07700 900123',
                'Link': 'https://www.spareroom.co.uk/flatshare/flatshare_detail.pl?flatshare_id=12345678',
                'Location': 'Leeds', 'AgentType': 'live out landlord', 'Advertiser Name': 'Owner', **changes}

    def test_weekly_rent_is_converted_using_52_weeks_not_four(self):
        result = module.screen(self.row(Price='150pw'), advert('150 pw'))
        self.assertEqual(result['rent_pcm'], 650)
        self.assertEqual(result['source_price'], '£150 pw')

    def test_live_page_is_authoritative_when_weekly_and_monthly_agree(self):
        result = module.screen(self.row(Price='150pw'), advert('650 pcm'))
        self.assertEqual(result['source_price'], '£650 pcm')

    def test_conflicting_asking_prices_are_blocked(self):
        with self.assertRaisesRegex(module.Rejected, 'price_mismatch'):
            module.screen(self.row(Price='150pw'), advert('800 pcm'))

    def test_room_and_shared_kitchen_cannot_enter_import(self):
        for text in [advert(kind='room'), advert(description='Shared kitchen with other tenants.')]:
            with self.assertRaises(module.Rejected):
                module.screen(self.row(), text)

    def test_no_shared_facilities_is_not_misclassified(self):
        self.assertEqual(module.screen(self.row(), advert(description='No shared kitchen. Your own bathroom.'))['outcode'], 'LS1')

    def test_current_tenant_has_no_assumed_landlord_authority(self):
        with self.assertRaisesRegex(module.Rejected, 'authority'):
            module.screen(self.row(AgentType='current flatmate'), advert())

    def test_missing_photo_and_two_bed_property_are_blocked(self):
        for text in [advert().replace('href=', 'data-other='), advert(kind='2 bed flat')]:
            with self.assertRaises(module.Rejected):
                module.screen(self.row(), text)

    def test_london_is_excluded_even_if_search_radius_reaches_it(self):
        with self.assertRaisesRegex(module.Rejected, 'london'):
            module.screen(self.row(), advert().replace('Leeds, LS1:', 'London, SW1:'))

    def test_number_formats_deduplicate_to_one_contact(self):
        self.assertEqual(module.phone('07700 900123'), module.phone('+44 7700 900123'))
        self.assertEqual(module.phone('0044 7700 900123'), module.phone('07700 900123'))
        self.assertEqual(module.phone('not a number'), '')


class HistoryTests(unittest.TestCase):
    class Api:
        def __init__(self, desk='sa', queue=True, calls=False, opted_out=False):
            self.writes = []
            self.desk, self.queue, self.calls, self.opted_out = desk, queue, calls, opted_out

        def db(self, table, query=None, body=None, **kwargs):
            if body is not None:
                self.writes.append((table, body))
                return [{'id': 'new'}]
            if table == 'wk_contacts':
                return [{'id': 'existing', 'desk': self.desk, 'owner_agent_id': 'pedro', 'do_not_call': self.opted_out}]
            if table == 'sa_listings':
                return [{'id': 'property', 'wk_contact_id': 'existing', 'rent_pcm': 650, 'source_price': '£650 pcm',
                         'photo_urls': ['existing-photo'], 'report_property': {'postcode': 'LS1'}, 'hostunico_call_eligible': True}]
            if table == 'wk_dialer_queue':
                return [{'id': 'done-queue'}] if self.queue else []
            if table == 'wk_calls':
                return [{'id': 'previous-call'}] if self.calls else []
            raise AssertionError(table)

    def item(self):
        return {'phone': '+447700900123', 'advert_id': '12345678', 'rent_pcm': 650}

    def test_existing_queue_and_history_are_preserved(self):
        api = self.Api()
        module.import_property(api, self.item(), 'pedro', 'new-lead')
        self.assertEqual(api.writes, [])

    def test_past_manual_call_does_not_become_a_new_queue_entry(self):
        api = self.Api(queue=False, calls=True)
        module.import_property(api, self.item(), 'pedro', 'new-lead')
        self.assertEqual(api.writes, [])

    def test_other_desks_and_opt_outs_are_never_reassigned(self):
        for api in [self.Api(desk='auction'), self.Api(opted_out=True)]:
            with self.assertRaises(module.Rejected):
                module.import_property(api, self.item(), 'pedro', 'new-lead')
            self.assertEqual(api.writes, [])

    def test_changed_listing_phone_does_not_leave_an_orphan_contact(self):
        api = self.Api()
        original = api.db
        api.db = lambda table, *a, **k: [] if table == 'wk_contacts' and k.get('body') is None else original(table, *a, **k)
        with self.assertRaisesRegex(module.Rejected, 'listing_contact_conflict'):
            module.import_property(api, self.item(), 'pedro', 'new-lead')
        self.assertEqual(api.writes, [])

    def test_missing_old_photo_and_report_inputs_are_repaired_from_the_verified_advert(self):
        api = self.Api()
        original = api.db
        def db(table, *args, **kwargs):
            result = original(table, *args, **kwargs)
            if table == 'sa_listings' and kwargs.get('body') is None:
                result[0].update(photo_urls=[], report_property=None, hostunico_call_eligible=False)
            return result
        api.db = db
        item = module.screen(ScreeningTests().row(), advert())
        module.import_property(api, item, 'pedro', 'new-lead')
        self.assertEqual(len(api.writes), 1)
        table, patch = api.writes[0]
        self.assertEqual(table, 'sa_listings')
        self.assertEqual(patch['photo_urls'], item['photos'])
        self.assertEqual(patch['report_property']['postcode'], 'LS1')
        self.assertTrue(patch['report_property']['areaEstimate'])


class ReportProgressTests(unittest.TestCase):
    def test_service_outage_defers_remote_requests_but_still_counts_cached_research(self):
        class Api:
            def __init__(self):
                self.requests = 0

            def db(self, table, query=None, **kwargs):
                if table == 'sa_property_reports':
                    researched = query['listing_id'] == 'eq.cached'
                    return [{'state': 'ready', 'report_pitch': {'planning': not researched},
                             'remote_id': 'stable-id', 'access_token': 'private-token', 'report_url': 'existing-link'}]
                if table == 'sa_listings':
                    return [{'address': 'Studio', 'photo_urls': ['photo'], 'listing_url': 'listing',
                             'property_type': 'Studio', 'rent_pcm': 650, 'source_price': '£650 pcm',
                             'hostunico_call_eligible': True}]
                raise AssertionError(table)

            def report(self, action, data):
                self.requests += 1
                raise RuntimeError('Report status HTTP 503')

        api = Api()
        with redirect_stdout(io.StringIO()):
            counts = module.sync_reports(api, ['failed', 'cached', 'deferred'])
        self.assertEqual(counts, (1, 2, 1))
        self.assertEqual(api.requests, 1)

    def test_failed_reports_remain_waiting_and_other_reports_continue_without_leaking_secrets(self):
        output = io.StringIO()
        results = [RuntimeError('Report status HTTP 503 credential=private-value'), True, False]
        with patch.object(module, 'sync_report', side_effect=results) as sync, redirect_stdout(output):
            counts = module.sync_reports(object(), ['failed', 'researched', 'planning'])
        self.assertEqual(counts, (1, 2, 1))
        self.assertEqual(sync.call_count, 3)
        event = json.loads(output.getvalue())
        self.assertEqual(event['http_status'], 503)
        self.assertEqual(event['listing_id'], 'failed')
        self.assertNotIn('private-value', output.getvalue())


class RunSelectionTests(unittest.TestCase):
    def test_added_city_runs_are_read_from_config_without_importing_unrelated_runs(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.execute('create table runs (id integer, label text, location text, status text, file_name text)')
        for run_id in (9, 10, 20, 21, 22):
            db.execute('insert into runs values (?, ?, ?, ?, ?)',
                       (run_id, 'Pedro tomorrow - Hull 40 miles', 'Hull', 'done', 'city.csv'))
        with tempfile.TemporaryDirectory() as directory:
            ops = Path(directory)
            self.assertEqual([r['id'] for r in module.supply_runs(db, ops)], [10, 20])
            (ops / 'supply-runs.json').write_text(json.dumps([10, 20, 21]))
            self.assertEqual([r['id'] for r in module.supply_runs(db, ops)], [10, 20, 21])

    def test_invalid_run_config_is_rejected_instead_of_widening_import_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            ops = Path(directory)
            for config in ([], ['21'], [True], [0], {'runs': [21]}):
                (ops / 'supply-runs.json').write_text(json.dumps(config))
                with self.assertRaises(ValueError):
                    module.supply_runs(sqlite3.connect(':memory:'), ops)


if __name__ == '__main__':
    unittest.main()
