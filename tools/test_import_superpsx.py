"""Offline regressions for SuperPSX's old tables, new cards and password propagation."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("superpsx", Path(__file__).with_name("import-superpsx.py"))
spx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(spx)

URL = "https://vikingfile.com/f/Example123"


def file_card(name="Game", url=URL, extra=""):
    return f"""<div class='spsx-file'><div class='spsx-file-info'>
      <div class='spsx-file-name'>{name}</div><div class='spsx-file-note'>5.05+</div></div>
      <div class='spsx-file-hosts'><a class='spsx-btn spsx-host' href='{url}'>Viki</a></div>{extra}</div>"""


def version_card(version="CUSA00001 – USA", password="SuperPSX", files=None):
    field = f"<div class='spsx-pass'><span>Password</span><code class='spsx-pass-v'>{password}</code><button>Copy</button></div>"
    return f"<section class='spsx-ver'><span class='spsx-ver-t'>{version}</span>{files or file_card()}{field}</section>"


def old_table(version="CUSA00001 – USA", password="SuperPSX", url=URL):
    return f"""<table><tbody>
      <tr><td><strong>Version&nbsp;⇛</strong></td><td>{version}</td></tr>
      <tr><td><strong>Game (5.05+) ⇛</strong></td><td><a href="{url}">Viki</a></td></tr>
      <tr><td><strong>Update <em>v1.28</em> (5.05+) ⇛</strong></td><td><a href="{url}Update">Viki</a></td></tr>
      <tr><td><strong>Password ⇛</strong></td><td><strong>{password}</strong></td></tr>
      </tbody></table>"""


class DownloadPageTest(unittest.TestCase):
    def test_modern_cards_keep_version_passwords_separate(self):
        body = version_card(password="(DLPSGAME.COM)_123") + version_card(
            "CUSA00002 – EUR", "hako or ByAlvRo", file_card(url=URL + "EUR"))
        sections = spx.parse_download_page(body)
        self.assertEqual(len(sections), 2)
        self.assertEqual(sections[0]["version"], "CUSA00001 – USA")
        self.assertEqual(sections[0]["passwords"], ["(DLPSGAME.COM)_123"])
        self.assertEqual(sections[1]["passwords"], ["hako", "ByAlvRo"])

    def test_modern_file_overrides_only_its_own_password(self):
        fields = "<code class='spsx-pass-v'>Keep Case [42]!</code>"
        files = file_card(extra=fields) + file_card("Update v1.28", URL + "Update")
        sections = spx.parse_download_page(version_card(files=files))
        self.assertEqual([s["passwords"] for s in sections], [["Keep Case [42]!"], ["SuperPSX"]])
        self.assertEqual(spx.section_kind(sections[1]["name"]), ("Update", "1.28"))

    def test_explicit_empty_file_password_does_not_inherit(self):
        files = file_card(extra="<code class='spsx-pass-v'></code>")
        self.assertEqual(spx.parse_download_page(version_card(files=files))[0]["passwords"], [])

    def test_html_entities_in_links_and_passwords_are_decoded_once(self):
        body = version_card(password="Case &amp;amp; [42]", files=file_card(url=URL + "?a=1&amp;b=2"))
        section = spx.parse_download_page(body)[0]
        self.assertEqual(section["links"][0][1], URL + "?a=1&b=2")
        self.assertEqual(section["passwords"], ["Case &amp; [42]"])

    def test_old_tables_keep_passwords_per_region(self):
        body = old_table(password="Th3B4tm4nWhoL4ugh$") + old_table("CUSA00002 – EUR", "luis alberto", URL + "EUR")
        sections = spx.parse_download_page(body)
        self.assertEqual(len(sections), 4)
        self.assertEqual([s["passwords"] for s in sections], [["Th3B4tm4nWhoL4ugh$"]] * 2 + [["luis alberto"]] * 2)
        self.assertEqual(spx.section_kind(sections[1]["name"]), ("Update", "1.28"))

    def test_old_single_table_with_two_version_rows(self):
        first = old_table(password="First")
        second = old_table("CUSA00002 – EUR", "Second", URL + "EUR")
        body = first.replace("</tbody></table>", "") + second.replace("<table><tbody>", "")
        sections = spx.parse_download_page(body)
        self.assertEqual([s["passwords"] for s in sections], [["First"]] * 2 + [["Second"]] * 2)

    def test_same_link_in_two_regions_does_not_mix_passwords(self):
        sections = spx.parse_download_page(old_table(password="USA") + old_table("CUSA00002 – EUR", "EUR"))
        self.assertEqual([s["passwords"] for s in sections], [["USA"]] * 2 + [["EUR"]] * 2)

    def test_password_alternatives_preserve_case_spaces_and_punctuation(self):
        self.assertEqual(spx.password_candidates(["hako or ByAlvRo", "(DLPSGAME.COM)", "hako", "luis alberto"]),
                         ["hako", "ByAlvRo", "(DLPSGAME.COM)", "luis alberto"])

    def test_login_and_empty_password_labels_are_not_archive_passwords(self):
        body = "<form>Password: <input name='password'>Remember Me</form>" + old_table(password="")
        body += "<p>Notes: another fix with several new features</p>"
        self.assertTrue(all(s["passwords"] == [] for s in spx.parse_download_page(body)))

    def test_news_with_no_download_cards_is_not_a_game(self):
        self.assertEqual(spx.parse_download_page("<article><h1>Game news</h1><p>Firmware report</p></article>"), [])


class ImportPasswordTest(unittest.TestCase):
    def plan(self, body, previous=None):
        with tempfile.TemporaryDirectory() as directory:
            spx.write_json(str(Path(directory) / "pages/1.json"), {
                "post": {"id": 1, "title": "Example PS4", "link": "https://www.superpsx.com/example/",
                         "downloads": ["https://www.superpsx.com/dll-example/"]}, "articles": [body],
            })
            games = {"CUSA00001": {"title": "Example", "hidden": False, "providers": ["vikingfile"], "index": 0}}
            lines = ['  { "id": "CUSA00001", "title": "Example", "platform": "ps4", "providers": ["vikingfile"] },']
            releases = {"CUSA00001": previous or []}
            with patch.object(spx, "catalog_games", return_value=(games, lines)), \
                    patch.object(spx, "read_releases", return_value=releases), \
                    patch.object(spx, "fetch", side_effect=AssertionError("Offline test attempted a network request")):
                return spx.build_plan(SimpleNamespace(cache=directory, scope="catalog", new=True))

    def test_singular_password_reaches_record_with_provenance(self):
        plan = self.plan(version_card(password="(DLPSGAME.COM)_123"))
        self.assertEqual(plan["records"]["CUSA00001"][0]["archivePassword"], "(DLPSGAME.COM)_123")
        evidence = plan["passwords"][0]
        self.assertEqual(evidence["pages"], ["https://www.superpsx.com/dll-example/"])
        self.assertEqual(evidence["page"], "https://www.superpsx.com/dll-example/")
        self.assertEqual(evidence["version"], "CUSA00001 – USA")
        self.assertEqual(evidence["passwords"], ["(DLPSGAME.COM)_123"])

    def test_alternatives_are_reported_not_joined_into_singular_metadata(self):
        plan = self.plan(version_card(password="hako or ByAlvRo"))
        self.assertNotIn("archivePassword", plan["records"]["CUSA00001"][0])
        self.assertEqual(plan["passwords"][0]["passwords"], ["hako", "ByAlvRo"])

    def test_rebuild_preserves_old_password_under_a_host_alias(self):
        previous = [{"source": "superpsx", "url": URL.replace("vikingfile.com", "vik1ngfile.site"),
                     "archivePassword": "Keep Case [42]!"}]
        plan = self.plan(version_card(password=""), previous)
        self.assertEqual(plan["records"]["CUSA00001"][0]["archivePassword"], "Keep Case [42]!")
        self.assertEqual(plan["passwordConflicts"], [])

    def test_existing_verified_alternative_is_preserved(self):
        previous = [{"source": "superpsx", "url": URL, "archivePassword": "ByAlvRo"}]
        plan = self.plan(version_card(password="hako or ByAlvRo"), previous)
        self.assertEqual(plan["records"]["CUSA00001"][0]["archivePassword"], "ByAlvRo")
        self.assertEqual(plan["passwordConflicts"], [])

    def test_conflicting_evidence_blocks_write_and_keeps_previous_metadata(self):
        previous = [{"source": "superpsx", "url": URL, "archivePassword": "Verified"}]
        plan = self.plan(version_card(password="Different"), previous)
        self.assertEqual(plan["records"]["CUSA00001"][0]["archivePassword"], "Verified")
        self.assertEqual(len(plan["passwordConflicts"]), 1)
        with patch.object(spx, "build_plan", return_value=plan), patch.object(spx, "apply_plan") as apply, \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(SystemExit, "Conflicting archive passwords"):
                spx.run_import(SimpleNamespace(write=True, report=None))
            apply.assert_not_called()

    def test_unsupported_hosts_are_still_not_imported(self):
        plan = self.plan(version_card(files=file_card(url="https://unsupported.example/file")))
        self.assertEqual(plan["records"], {})
        self.assertEqual(plan["skipped"]["other host"], 1)

    def test_dry_run_never_applies_the_plan(self):
        plan = self.plan(version_card())
        with patch.object(spx, "build_plan", return_value=plan), patch.object(spx, "apply_plan") as apply, \
                contextlib.redirect_stdout(io.StringIO()):
            spx.run_import(SimpleNamespace(write=False, report=None))
            apply.assert_not_called()

    def test_report_keeps_alternatives_and_their_exact_source_page(self):
        plan = self.plan(version_card(password="hako or ByAlvRo"))
        with tempfile.TemporaryDirectory() as directory, patch.object(spx, "build_plan", return_value=plan), \
                contextlib.redirect_stdout(io.StringIO()):
            report = Path(directory) / "report.json"
            spx.run_import(SimpleNamespace(write=False, report=str(report)))
            evidence = json.loads(report.read_text(encoding="utf-8"))["passwords"][0]
            self.assertEqual(evidence["passwords"], ["hako", "ByAlvRo"])
            self.assertEqual(evidence["page"], "https://www.superpsx.com/dll-example/")
            self.assertIsNone(evidence["archivePassword"])


if __name__ == "__main__":
    unittest.main()
