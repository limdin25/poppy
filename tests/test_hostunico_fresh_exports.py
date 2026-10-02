import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('fresh_exports', Path(__file__).parents[1] / 'scripts/hostunico_fresh_exports.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FreshExportsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.home = Path(self.directory.name)
        (self.home / 'ops').mkdir()
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.execute('create table runs(id integer, country text, started_at real)')
        self.db.execute('create table listings(run_id integer, advert_id text)')
        for run, country, stamp, aid in [(1, 'uk', 150, 'recent'), (2, 'uk', 10, 'old'),
                                         (3, 'us', 150, 'us'), (4, 'uk', 150, 'own')]:
            self.db.execute('insert into runs values (?,?,?)', (run, country, stamp))
            self.db.execute('insert into listings values (?,?)', (run, aid))

    def tearDown(self):
        self.db.close()
        self.directory.cleanup()

    def manifest(self, **values):
        (self.home / 'ops/fresh-export-runs.json').write_text(json.dumps({
            'run_ids': [4], 'verified_after': 100, 'expires_at': 300, **values}))

    def query(self, sql, args):
        return [dict(row) for row in self.db.execute(sql, args)]

    def test_only_recent_successfully_exported_uk_adverts_are_skipped(self):
        self.manifest()
        self.assertEqual(module.fresh_advert_ids(self.query, self.home, 4, 'uk', ['recent', 'old', 'us', 'own', 'new'], now=200),
                         ['old', 'us', 'own', 'new'])
        self.assertEqual(self.db.execute('select count(*) from listings').fetchone()[0], 4)

    def test_normal_runs_and_other_countries_keep_every_advert(self):
        self.manifest()
        for run, country in [(5, 'uk'), (4, 'us')]:
            self.assertEqual(module.fresh_advert_ids(self.query, self.home, run, country, ['recent', 'new'], now=200), ['recent', 'new'])

    def test_expired_or_invalid_manifests_never_drop_adverts(self):
        for values in [{'expires_at': 199}, {'verified_after': -90000}, {'run_ids': ['4']},
                       {'verified_after': 201}, {'expires_at': 9999999999}]:
            self.manifest(**values)
            self.assertEqual(module.fresh_advert_ids(self.query, self.home, 4, 'uk', ['recent'], now=200), ['recent'])

    def test_no_manifest_means_normal_export(self):
        self.assertEqual(module.fresh_advert_ids(self.query, self.home, 4, 'uk', ['recent'], now=200), ['recent'])


if __name__ == '__main__':
    unittest.main()
