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

    def test_ensuite_bedroom_title_is_not_a_verified_studio_even_if_ad_flag_says_studio(self):
        with self.assertRaisesRegex(module.Rejected, 'room_title'):
            module.screen(self.row(Name='Student Ensuite Double Bedroom - Preston Centre'), advert())

    def test_generic_photos_of_different_rooms_do_not_count_as_the_actual_property(self):
        for description in ['Photos show a variety of different rooms.', 'photos show a variaty of different rooms.']:
            with self.assertRaisesRegex(module.Rejected, 'generic_listing_photos'):
                module.screen(self.row(), advert(description=description))

    def test_whole_flat_with_a_double_bedroom_is_not_a_room_advert(self):
        self.assertEqual(module.screen(self.row(Name='One bed flat with ensuite double bedroom'), advert(kind='1 bed flat'))['rent_pcm'], 650)

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

    def test_border_properties_require_official_council_evidence(self):
        for outcode, councils in [('KT12', ['Elmbridge', 'Spelthorne']),
                                 ('TW18', ['Runnymede', 'Spelthorne', 'Windsor and Maidenhead']),
                                 ('EN11', ['Broxbourne', 'East Hertfordshire', 'Epping Forest'])]:
            source = advert().replace('Leeds, LS1:', 'Border town, ' + outcode + ':')
            with self.assertRaisesRegex(module.Rejected, 'london'):
                module.screen(self.row(), source)
            evidence = {'outcode': outcode, 'admin_district': councils}
            with patch.object(module, 'lookup_outcode_councils', return_value=evidence):
                self.assertEqual(module.screen_city_advert(self.row(), source)['outcode'], outcode)

    def test_london_and_mixed_outcodes_stay_excluded(self):
        for outcode, councils in [('KT1', ['Kingston upon Thames', 'Richmond upon Thames']),
                                 ('KT17', ['Epsom and Ewell', 'Sutton']),
                                 ('BR8', ['Bromley', 'Dartford', 'Sevenoaks']),
                                 ('DA6', ['Bexley']),
                                 ('WD6', ['Barnet', 'Hertsmere']),
                                 ('E1', ['Tower Hamlets'])]:
            source = advert().replace('Leeds, LS1:', 'Border town, ' + outcode + ':')
            with patch.object(module, 'lookup_outcode_councils', return_value={'outcode': outcode, 'admin_district': councils}):
                with self.assertRaisesRegex(module.Rejected, 'london'):
                    module.screen_city_advert(self.row(), source)

    def test_every_postcode_is_verified_not_only_a_prefix_list(self):
        source = advert()
        with patch.object(module, 'lookup_outcode_councils', return_value=None):
            with self.assertRaises(module.Rejected):
                module.screen_city_advert(self.row(), source)
        with patch.object(module, 'lookup_outcode_councils', return_value={'outcode': 'LS1', 'admin_district': ['Leeds']}):
            self.assertEqual(module.screen_city_advert(self.row(), source)['outcode'], 'LS1')

    def test_missing_or_mismatched_council_evidence_cannot_release_a_property(self):
        source = advert().replace('Leeds, LS1:', 'Border town, KT12:')
        for evidence in [None, {}, {'outcode': 'KT13', 'admin_district': ['Elmbridge']},
                         {'outcode': 'KT12', 'admin_district': []},
                         {'outcode': 'KT12', 'admin_district': [None]}]:
            with patch.object(module, 'lookup_outcode_councils', return_value=evidence):
                with self.assertRaises(module.Rejected):
                    module.screen_city_advert(self.row(), source)

    def test_council_api_failure_is_retryable_and_never_imported(self):
        source = advert().replace('Leeds, LS1:', 'Border town, KT12:')
        with patch.object(module, 'lookup_outcode_councils', side_effect=TimeoutError('unavailable')):
            with self.assertRaises(TimeoutError):
                module.screen_city_advert(self.row(), source)

    def test_border_recheck_preserves_imports_and_other_exclusions(self):
        state = {'checked': {'old-border': 'london_or_london_border', 'live': 'imported', 'room': 'shared_facilities'},
                 'rejections': {'london_or_london_border': 1, 'shared_facilities': 1}}
        module.prepare_border_recheck(state)
        self.assertEqual(state['checked'], {'live': 'imported', 'room': 'shared_facilities'})
        self.assertEqual(state['refresh_source_ids'], ['old-border'])
        module.prepare_border_recheck(state)
        self.assertEqual(state['refresh_source_ids'], ['old-border'])

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

    def test_blocked_new_property_is_attached_as_a_note_without_reassigning_or_queuing(self):
        for api in [self.Api(desk='auction'), self.Api(opted_out=True)]:
            original = api.db
            api.db = lambda table, *a, **k: [] if table == 'sa_listings' and k.get('body') is None else original(table, *a, **k)
            item = module.screen(ScreeningTests().row(), advert())
            with self.assertRaises(module.Rejected):
                module.import_property(api, item, 'pedro', 'new-lead')
            self.assertEqual([table for table, _ in api.writes], ['rpc/wk_ingest_contacts'])
            self.assertEqual(api.writes[0][1]['p_contacts']['custom_fields']['listing_url'], item['url'])

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


class SizeTests(unittest.TestCase):
    """Hugo, 7 Oct: whole 2 and 3-bed homes too, flats or houses, never rooms."""

    def test_two_and_three_bed_whole_homes_are_read_with_their_type(self):
        two = module.screen(ScreeningTests().row(Name='2 bed flat'), advert(kind='2 bed flat'), sizes={'2', '3'})
        self.assertEqual((two['bedrooms'], two['kind'], two['studio']), (2, 'Flat', False))
        three = module.screen(ScreeningTests().row(Name='Family home'), advert(kind='3 bed house'), sizes={'2', '3'})
        self.assertEqual((three['bedrooms'], three['kind']), (3, 'House'))

    def test_the_default_batch_still_takes_only_studios_and_one_bed_flats(self):
        for kind in ['2 bed flat', '3 bed house', '1 bed house']:
            with self.assertRaisesRegex(module.Rejected, 'not_a_studio_or_one_bed_flat'):
                module.screen(ScreeningTests().row(), advert(kind=kind))
        self.assertEqual(module.screen(ScreeningTests().row(), advert())['bedrooms'], None)

    def test_a_two_and_three_bed_batch_refuses_other_sizes_and_rooms(self):
        for kind in ['Studio flat', '1 bed flat', '4 bed house']:
            with self.assertRaisesRegex(module.Rejected, 'size_outside_this_batch'):
                module.screen(ScreeningTests().row(), advert(kind=kind), sizes={'2', '3'})
        with self.assertRaises(module.Rejected):
            module.screen(ScreeningTests().row(Name='Double room in 3 bed house'), advert(kind='3 bed house'), sizes={'2', '3'})
        with self.assertRaisesRegex(module.Rejected, 'not_a_whole_property'):
            module.screen(ScreeningTests().row(), advert(kind='3 bed house').replace('feature--price-whole-property', 'feature--price-room-only'), sizes={'2', '3'})

    def test_a_three_bed_listing_is_stored_and_researched_as_three_bedrooms(self):
        api = PhoneRuleTests.Api(lambda: [{'id': 'fresh', 'desk': 'sa', 'owner_agent_id': 'pedro', 'do_not_call': False}])
        item = module.screen(ScreeningTests().row(Name='Family home'), advert(kind='3 bed house'), sizes={'2', '3'})
        module.import_property(api, item, 'pedro', 'new-lead', 'uk-2-3-bed-2026-10-07')
        listing = [b for t, b in api.writes if t == 'sa_listings'][0]
        self.assertEqual((listing['bedrooms'], listing['property_type'], listing['report_property']['bedrooms']), (3, 'House', 3))
        self.assertIn('3-bedroom house', listing['hostunico_eligibility_note'])


class PhoneRuleTests(unittest.TestCase):
    """New numbers go through the CRM's one-person-per-number RPC."""

    class Api:
        def __init__(self, rpc):
            self.rpc, self.writes = rpc, []

        def db(self, table, query=None, body=None, **kwargs):
            if table == 'rpc/wk_ingest_contacts':
                self.writes.append((table, body))
                return self.rpc()
            if body is not None:
                self.writes.append((table, body))
                return [{'id': 'property'}]
            if table in ('sa_listings', 'wk_contacts', 'wk_dialer_queue', 'wk_calls'):
                return []
            raise AssertionError(table)

    def item(self):
        return module.screen(ScreeningTests().row(), advert())

    def test_new_contact_is_labelled_with_the_requested_batch_and_held_for_the_report(self):
        api = self.Api(lambda: [{'id': 'fresh', 'desk': 'sa', 'owner_agent_id': 'pedro', 'do_not_call': False}])
        module.import_property(api, self.item(), 'pedro', 'new-lead', 'uk-fresh-2026-10-07')
        tables = [t for t, _ in api.writes]
        self.assertEqual(tables, ['rpc/wk_ingest_contacts', 'sa_listings', 'wk_dialer_queue'])
        self.assertEqual(api.writes[0][1]['p_contacts']['custom_fields']['source_batch'], 'uk-fresh-2026-10-07')
        queue = api.writes[2][1]
        self.assertEqual((queue['status'], queue['hostunico_uplift_hold']), ('skipped', True))

    def test_cooldown_or_permanent_suppression_rejects_the_lead_without_listing_or_queue(self):
        for code, reason in [('23514', 'phone_suppressed_or_in_cooldown'), ('22023', 'invalid_number')]:
            def refuse(code=code):
                raise RuntimeError('CRM rpc HTTP 400 code ' + code)
            api = self.Api(refuse)
            with self.assertRaisesRegex(module.Rejected, reason):
                module.import_property(api, self.item(), 'pedro', 'new-lead')
            self.assertEqual([t for t, _ in api.writes], ['rpc/wk_ingest_contacts'])

    def test_other_crm_failures_stay_retryable(self):
        def fail():
            raise RuntimeError('CRM rpc HTTP 503')
        with self.assertRaises(RuntimeError):
            module.import_property(self.Api(fail), self.item(), 'pedro', 'new-lead')

    def test_canonical_contact_on_another_desk_or_opted_out_is_never_attached(self):
        for row in [{'id': 'house', 'desk': 'houses', 'owner_agent_id': 'pedro', 'do_not_call': False},
                    {'id': 'other', 'desk': 'sa', 'owner_agent_id': 'marr', 'do_not_call': False},
                    {'id': 'dnc', 'desk': 'sa', 'owner_agent_id': 'pedro', 'do_not_call': True}]:
            api = self.Api(lambda row=row: [row])
            with self.assertRaises(module.Rejected):
                module.import_property(api, self.item(), 'pedro', 'new-lead')
            self.assertEqual([t for t, _ in api.writes], ['rpc/wk_ingest_contacts'])

    def test_returned_existing_person_with_call_history_gets_no_new_queue_row(self):
        api = self.Api(lambda: [{'id': 'known', 'desk': 'sa', 'owner_agent_id': 'pedro', 'do_not_call': False}])
        original = api.db
        api.db = lambda table, *a, **k: [{'id': 'call'}] if table == 'wk_calls' else original(table, *a, **k)
        module.import_property(api, self.item(), 'pedro', 'new-lead')
        self.assertNotIn('wk_dialer_queue', [t for t, _ in api.writes])

    def test_crm_errors_keep_only_the_postgres_code(self):
        error = urllib_error(400, b'{"code":"23514","message":"Phone number +447700900123 is in cooldown"}')
        api = module.Api({'SUPABASE_URL': 'https://loggyxryrhqsbtqpteog.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY': 'k'}, 't')
        with patch.object(module.urllib.request, 'urlopen', side_effect=error):
            with self.assertRaises(RuntimeError) as raised:
                api.db('rpc/wk_ingest_contacts', body={})
        self.assertEqual(str(raised.exception), 'CRM rpc HTTP 400 code 23514')


def urllib_error(status, body):
    return module.urllib.error.HTTPError('https://example.invalid', status, 'error', {}, io.BytesIO(body))


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


class ResumedSupplyTests(unittest.TestCase):
    def test_report_refresh_interval_releases_new_results_without_waiting_fifteen_minutes(self):
        self.assertFalse(module.report_sync_due(100, False, now=279, interval=180))
        self.assertTrue(module.report_sync_due(100, False, now=280, interval=180))
        self.assertFalse(module.report_sync_due(100, False, now=280))
        self.assertTrue(module.report_sync_due(100, True, now=101))

    def test_explicit_one_pass_resumes_after_old_overnight_deadline(self):
        self.assertTrue(module.run_window_open(True, 100, 200))
        self.assertFalse(module.run_window_open(False, 100, 200))
        self.assertTrue(module.run_window_open(False, 300, 200))
        self.assertFalse(module.run_window_open(False, 200, 200))

    def test_all_properties_get_report_refresh_when_a_contact_has_several(self):
        state = {'contacts': {'owner1': 'old-low-yield', 'owner2': 'another'},
                 'properties': ['old-low-yield', 'new-high-yield', 'new-high-yield']}
        self.assertEqual(module.report_listing_ids(state),
                         ['old-low-yield', 'new-high-yield', 'another'])
        self.assertEqual(module.report_listing_ids({'contacts': {'owner': 'legacy'}}), ['legacy'])


if __name__ == '__main__':
    unittest.main()
