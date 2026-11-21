# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Runtime text line breaking (native/shared/text_shaper.cpp) and text clipping, with text-lab's fonts."""
from pathlib import Path
import subprocess
import sys
import unicodedata
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cli import desktop  # noqa: E402
from common import ROOT  # noqa: E402

LAB = ROOT / "apps/text-lab"
FAMILY = "Inter-Regular"
# Overdrive's downloads notes: text-sm (14 px) in a w-[280px] box, at its 1.5 render scale.
SIZE, WIDTH = 21, 420
NO_START = set("!),.:;?]}、。，．：；？！）」』】〕〉》ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々ゝゞヽヾ")
NO_END = set("([{「『【〔〈《（")

# Every line as it is laid out, separated by the spaces the break drops.
GOLDEN = {
    "hi": ("पूरे गेम ShadowMount से इंस्टॉल होते हैं, जब कोई गेम खुला न हो। पूरा करने के लिए Overdrive बंद करें।",
           ["पूरे गेम ShadowMount से इंस्टॉल होते हैं, जब कोई", "गेम खुला न हो। पूरा करने के लिए Overdrive बंद",
            "करें।"]),
    "hi-awake": ("कंसोल डाउनलोड खत्म होने तक जागृत रहता है।", ["कंसोल डाउनलोड खत्म होने तक जागृत रहता है।"]),
    "bn": ("শেষ হওয়া গেম ShadowMount দিয়ে ইনস্টল হয়, যখন কোনো গেম খোলা থাকে না। শেষ করতে Overdrive বন্ধ করুন।",
           ["শেষ হওয়া গেম ShadowMount দিয়ে ইনস্টল হয়,", "যখন কোনো গেম খোলা থাকে না। শেষ করতে",
            "Overdrive বন্ধ করুন।"]),
    "bn-awake": ("কনসোল ডাউনলোড শেষ না হওয়া পর্যন্ত জেগে থাকে।",
                 ["কনসোল ডাউনলোড শেষ না হওয়া পর্যন্ত জেগে", "থাকে।"]),
    "ar": ("تثبيت الألعاب المنتهية عبر ShadowMount، الذي ينتظر حتى عدم فتح أي لعبة. أغلق Overdrive لإنهاء.",
           ["تثبيت الألعاب المنتهية عبر ShadowMount،", "الذي ينتظر حتى عدم فتح أي لعبة. أغلق", "Overdrive لإنهاء."]),
    "ar-awake": ("وحدة التحكم تبقى مستيقظة حتى اكتمال التحميلات.",
                 ["وحدة التحكم تبقى مستيقظة حتى اكتمال", "التحميلات."]),
    "ur": ("مکمل گیمز ShadowMount سے انسٹال ہوتی ہیں، جب کوئی گیم کھلی نہ ہو۔ مکمل کرنے کے لیے Overdrive بند کریں۔",
           ["مکمل گیمز ShadowMount سے انسٹال ہوتی", "ہیں، جب کوئی گیم کھلی نہ ہو۔ مکمل کرنے کے لیے",
            "Overdrive بند کریں۔"]),
    "ja": ("完了したゲームはShadowMountでインストールされ、ゲームが開いていない間に実行されます。Overdriveを終了すると完了します。",
           ["完了したゲームはShadowMountでインス", "トールされ、ゲームが開いていない間に実行",
            "されます。Overdriveを終了すると完了しま", "す。"]),
    "ja-lab": ("「こんにちは」と彼は言った。日本語の文章は、単語の間に空白がなくても折り返せます。",
               ["「こんにちは」と彼は言った。日本語の文章", "は、単語の間に空白がなくても折り返せま", "す。"]),
    "zh": ("已完成的游戏通过 ShadowMount 安装，它会等到没有游戏运行时才开始。请关闭 Overdrive 以让其完成。",
           ["已完成的游戏通过 ShadowMount 安装，它", "会等到没有游戏运行时才开始。请关闭", "Overdrive 以让其完成。"]),
}
LANGUAGE = {"ja": "ja", "ja-lab": "ja", "zh": "zh-Hans"}
SPACED = ("hi", "bn", "ar", "ur")


class TextClient:
    def __init__(self):
        _, build = desktop(LAB, target="ps5-react-text-test")
        self.process = subprocess.Popen([build / "ps5-react-text-test", ROOT / ".build/text-lab/generated/fonts"],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8")

    def ask(self, *fields):
        self.process.stdin.write("\t".join(map(str, fields)) + "\n")
        self.process.stdin.flush()
        return self.process.stdout.readline().split()

    def lines(self, text, width=WIDTH, language="en"):
        """Engine line count, its widest line, and each line's text from the byte ranges the shaper reports."""
        count, widest, *ranges = self.ask("lines", language, FAMILY, SIZE, width, text)
        data = text.encode()
        spans = [tuple(map(int, r.split(":"))) for r in ranges]
        return int(count), int(widest), spans, [data[a:b].decode() for a, b in spans]

    def clip(self, text, limit):
        return int(self.ask("clip", limit, text)[0])

    def close(self):
        self.process.stdin.close()
        self.process.wait()


def grapheme_boundary(text, index):
    """No combining mark starts the rest and no virama or joiner ends the kept part."""
    if index in (0, len(text)):
        return True
    return (not unicodedata.category(text[index]).startswith("M") and text[index] not in "‌‍"
            and unicodedata.combining(text[index - 1]) != 9 and text[index - 1] != "‍")


def setUpModule():
    LineBreaking.client = Clipping.client = TextClient()


def tearDownModule():
    LineBreaking.client.close()


class LineBreaking(unittest.TestCase):
    client = None

    def test_golden_layouts(self):
        for name, (text, expected) in GOLDEN.items():
            with self.subTest(name):
                count, widest, _, lines = self.client.lines(text, language=LANGUAGE.get(name, "en"))
                self.assertEqual(lines, expected)
                self.assertEqual(count, len(lines), "layout and drawing break differently")
                self.assertLessEqual(widest, WIDTH)

    def test_space_separated_scripts_break_at_spaces(self):
        for name in [n for n in GOLDEN if n.split("-")[0] in SPACED]:
            text = GOLDEN[name][0]
            data = text.encode()
            _, _, spans, _ = self.client.lines(text)
            with self.subTest(name):
                self.assertEqual((spans[0][0], spans[-1][1]), (0, len(data)))
                for (_, end), (start, _) in zip(spans, spans[1:]):
                    gap = data[end:start].decode()
                    self.assertTrue(gap and not gap.strip(), f"breaks inside a word at byte {end}")

    def test_cjk_kinsoku(self):
        for name in ("ja", "ja-lab", "zh"):
            text = GOLDEN[name][0]
            _, _, _, lines = self.client.lines(text, language=LANGUAGE[name])
            with self.subTest(name):
                for line in lines[1:]:
                    self.assertNotIn(line[0], NO_START, line)
                for line in lines[:-1]:
                    self.assertNotIn(line[-1], NO_END, line)

    def test_words_wider_than_the_line_break_between_graphemes(self):
        for text in ("क्षत्रियद्वारश्रीकृष्णस्त्रीक्षमा", "ক্ষত্রিয়জ্ঞানশ্রীস্ত্রীক্ষমা", "ShadowMountShadowMount"):
            _, _, spans, lines = self.client.lines(text, width=60)
            with self.subTest(text):
                self.assertGreater(len(lines), 2)
                self.assertEqual("".join(lines), text)
                data = text.encode()
                for _, end in spans[:-1]:
                    self.assertTrue(grapheme_boundary(text, len(data[:end].decode())), f"cut at byte {end}")

    def test_one_grapheme_wider_than_the_line_stays_whole(self):
        _, _, _, lines = self.client.lines("क्ष", width=4)
        self.assertEqual(lines, ["क्ष"])


class Clipping(unittest.TestCase):
    """er_utf8_clip, which Text, TextInput and span strings are copied through at 255 and 63 bytes."""

    client = None

    def test_examples(self):
        for text, limit, kept in (("abc", 10, 3), ("abc", 2, 2), ("日本語", 8, 6), ("日本語", 6, 6), ("日本語", 5, 3),
                                  ("क्ष", 9, 9), ("क्ष", 8, 0), ("क्ष", 6, 0), ("कि", 3, 0), ("éx", 2, 0),
                                  ("a😀b", 4, 1), ("a😀b", 5, 5)):
            with self.subTest(text=text, limit=limit):
                self.assertEqual(self.client.clip(text, limit), kept)

    def test_every_cut_of_each_script(self):
        for name in ("hi", "bn", "ar", "ur", "ja", "zh"):
            text = GOLDEN[name][0]
            data = text.encode()
            for limit in range(len(data) + 1):
                kept = self.client.clip(text, limit)
                with self.subTest(name=name, limit=limit):
                    self.assertLessEqual(kept, limit)
                    self.assertGreater(kept, limit - 24)  # a cluster or conjunct, never more
                    prefix = data[:kept].decode()  # raises on half a character
                    self.assertTrue(grapheme_boundary(text, len(prefix)))


if __name__ == "__main__":
    unittest.main()
