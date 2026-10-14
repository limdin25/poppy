import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('nightly', Path(__file__).parents[1] / 'scripts/hostunico-nightly-supply.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NightlySupplyTests(unittest.TestCase):
    def test_settings_come_from_the_crm_with_safe_defaults(self):
        s = module.nightly_settings(json.dumps({'cities': [{'name': 'Leeds', 'searches': ['1494390998', '1495749127']}, {'name': 'Bad', 'searches': ['x']}],
                                                'max_new_listings': 150, 'target_ready': 150}))
        self.assertEqual([c['name'] for c in s['cities']], ['Leeds'])
        self.assertEqual((s['max_new_listings'], s['target_ready'], s['enabled']), (150, 150, True))
        self.assertEqual(s['sizes'], frozenset({'studio', '1', '2', '3'}))
        self.assertFalse(module.nightly_settings(json.dumps({'enabled': False}))['enabled'])
        self.assertEqual(module.nightly_settings(json.dumps({'max_new_listings': -5}))['max_new_listings'], 150)

    def test_contacts_needed_covers_the_gap_to_the_target(self):
        settings = {'target_ready': 150}
        self.assertEqual(module.contacts_needed({'ready': 150, 'held_waiting_report': 0}, settings), 0)
        self.assertEqual(module.contacts_needed({'ready': 100, 'held_waiting_report': 20}, settings), 75)
        self.assertEqual(module.contacts_needed({'ready': 200, 'held_waiting_report': 50}, settings), 0)

    def test_an_expired_spareroom_login_is_reported_not_hidden(self):
        self.assertEqual(module.session_state([{'status': 'error', 'message': 'SpareRoom sign-in failed, so phone numbers would be hidden.', 'total': 0, 'with_phone': 0}]), 'expired')
        self.assertEqual(module.session_state([{'status': 'done', 'message': '', 'total': 40, 'with_phone': 0}]), 'expired')
        self.assertEqual(module.session_state([{'status': 'done', 'message': '', 'total': 40, 'with_phone': 12}]), 'ok')
        self.assertEqual(module.session_state([{'status': 'queued', 'message': '', 'total': 0, 'with_phone': 0}]), 'unknown')

    def test_london_day_follows_the_clock_change(self):
        self.assertEqual(module.london_day(1792020600), '2026-10-15')  # 23:30 UTC on 14 Oct is 00:30 on 15 Oct London
        

if __name__ == '__main__':
    unittest.main()
