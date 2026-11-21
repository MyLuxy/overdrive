# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Package data validation: no console access, large JS data or external writes."""
from pathlib import Path
import tempfile
import unittest
from common import resource_files

class ResourceTests(unittest.TestCase):
    def test_directory_and_file_are_deduplicated(self):
        with tempfile.TemporaryDirectory() as root:
            app = Path(root)
            (app / "data").mkdir()
            (app / "data/catalog.json").write_text("[]")
            files = resource_files(app, {"resources": ["data", "data/catalog.json"]})
            self.assertEqual(list(files), [Path("data/catalog.json")])

    def test_invalid_paths_and_reserved_package_files(self):
        with tempfile.TemporaryDirectory() as root:
            app = Path(root)
            (app / "eboot.bin").write_text("test")
            for entry in ("../outside", "/absolute", "eboot.bin", "missing", "bad\\path", "bad\0path"):
                with self.assertRaises(ValueError): resource_files(app, {"resources": [entry]})
            (app / "data").mkdir()
            (app / "data/link").symlink_to(app / "eboot.bin")
            with self.assertRaises(ValueError): resource_files(app, {"resources": ["data"]})

if __name__ == "__main__": unittest.main()
