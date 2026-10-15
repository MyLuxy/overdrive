#!/usr/bin/env python3
"""Ensure app/i18n/locales/en.json is complete (upstream + language.setup*)."""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EN = ROOT / "app/i18n/locales/en.json"

def main() -> None:
    need = True
    if EN.exists():
        try:
            data = json.loads(EN.read_text(encoding="utf-8"))
            need = "_note" in data or len(data) < 400 or "browse.addToFavorites" not in data
        except Exception:
            need = True
    if not need:
        print("en.json ok", len(json.loads(EN.read_text(encoding="utf-8"))), "keys")
        return
    print("restoring en.json from MyLuxy/overdrive…")
    en = json.loads(
        urllib.request.urlopen(
            "https://raw.githubusercontent.com/MyLuxy/overdrive/main/app/i18n/locales/en.json"
        ).read()
    )
    en["language.setupTitle"] = "Choose your language"
    en["language.setupSubtitle"] = (
        "Overdrive's interface will use this language. "
        "Game titles and descriptions stay as the store lists them."
    )
    en["language.setupHint"] = "You can change the language later in Settings (gear icon)."
    EN.parent.mkdir(parents=True, exist_ok=True)
    EN.write_text(json.dumps(en, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", EN, "keys", len(en))

if __name__ == "__main__":
    main()
