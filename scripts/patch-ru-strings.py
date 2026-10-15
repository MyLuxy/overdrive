#!/usr/bin/env python3
import json
from pathlib import Path

ru_path = Path("app/i18n/locales/ru.json")
ru = json.loads(ru_path.read_text(encoding="utf-8"))
ru["search.tryGenre"] = "Проверьте написание или попробуйте жанр:"
ru["language.name.fa"] = "Персидский"
ru_path.write_text(json.dumps(ru, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("patched", len(ru), "keys")
