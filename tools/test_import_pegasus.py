"""Refreshing Pegasus sources must retain verified passwords and recognize host aliases."""
import importlib.util
from pathlib import Path
import json
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pegasus', Path(__file__).with_name('import-pegasus.py'))
pegasus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pegasus)


class ImportPasswordsTest(unittest.TestCase):
    def plan(self, existing, new_url='https://vik1ngf1le.online/f/Example123'):
        with tempfile.TemporaryDirectory() as cache:
            package = {'titleId': 'PPSA00001', 'title': 'Example', 'category': 'game',
                       'downloadLinks': [{'name': 'Base - VikingFile', 'url': new_url}]}
            Path(cache, 'dlps.json').write_text(json.dumps({'packages': [package]}), encoding='utf-8')
            games = {'PPSA00001': {'title': 'Example', 'platform': 'ps5', 'providers': ['vikingfile'], 'index': 0, 'ours': False}}
            with patch.object(pegasus, 'catalog_games', return_value=(games, [])), \
                    patch.object(pegasus, 'read_releases', return_value={'PPSA00001': existing}):
                return pegasus.build_plan(SimpleNamespace(cache=cache, new=True))

    def test_refresh_keeps_exact_password_across_viking_aliases(self):
        previous = [{'source': 'pegasus-dlps', 'url': 'https://vikingfile.com/f/Example123',
                     'archivePassword': '(DLPSGAME.COM)_123'}]
        rows = self.plan(previous)['records']['PPSA00001']
        self.assertEqual(rows[0]['archivePassword'], '(DLPSGAME.COM)_123')

    def test_a_password_is_not_assigned_to_another_file(self):
        previous = [{'source': 'pegasus-dlps', 'url': 'https://vikingfile.com/f/Other12345', 'archivePassword': 'Old'}]
        self.assertNotIn('archivePassword', self.plan(previous)['records']['PPSA00001'][0])

    def test_existing_manual_alias_is_not_added_as_a_duplicate(self):
        previous = [{'source': 'manual', 'url': 'https://vikingfile.com/f/Example123'}]
        self.assertEqual(self.plan(previous)['records'], {})

    def test_conflicting_existing_passwords_stop_before_writing(self):
        previous = [{'source': 'pegasus-dlps', 'url': 'https://vikingfile.com/f/Example123', 'archivePassword': value}
                    for value in ['One', 'Two']]
        with self.assertRaisesRegex(ValueError, 'Conflicting existing archive passwords'):
            self.plan(previous)


if __name__ == '__main__':
    unittest.main()
