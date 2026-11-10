"""Offline regression checks for the enrichment tool's title-list refresh."""
import importlib.util
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("enrich_catalog", pathlib.Path(__file__).with_name("enrich-catalog.py"))
enrich = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enrich)

TITLE_LIST = b"titleId\tconceptId\tname\tcontentId\nCUSA00001_00\t100\tExample\tEP0000\n"


class TitleListsTest(unittest.TestCase):
    def test_missing_and_expired_lists_are_downloaded(self):
        for expired in (False, True):
            with self.subTest(expired=expired), tempfile.TemporaryDirectory() as directory:
                cache = enrich.Cache(directory)
                if expired:
                    for platform in ("PS5", "PS4"):
                        path = cache.directory / f"{platform}_Titles.tsv"
                        path.write_bytes(TITLE_LIST)
                        os.utime(path, (0, 0))
                with patch.object(enrich, "fetch", return_value=TITLE_LIST) as fetch:
                    concept, region, names, siblings = enrich.load_titles(cache)
                self.assertEqual([call.args[0] for call in fetch.call_args_list], [
                    f"https://raw.githubusercontent.com/andshrew/PlayStation-Titles/main/{platform}_Titles.tsv"
                    for platform in ("PS5", "PS4")
                ])
                self.assertEqual(concept["CUSA00001"], "100")
                self.assertEqual(region["CUSA00001"], "EP")
                self.assertEqual(names["CUSA00001"], "Example")
                self.assertIn("CUSA00001", siblings["100"])
                for platform in ("PS5", "PS4"):
                    self.assertEqual((cache.directory / f"{platform}_Titles.tsv").read_bytes(), TITLE_LIST)

    def test_fresh_lists_do_not_download(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = enrich.Cache(directory)
            for platform in ("PS5", "PS4"):
                (cache.directory / f"{platform}_Titles.tsv").write_bytes(TITLE_LIST)
            with patch.object(enrich, "fetch") as fetch:
                enrich.load_titles(cache)
            fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
