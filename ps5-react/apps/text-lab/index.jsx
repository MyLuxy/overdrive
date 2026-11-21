// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// One sample per script the framework renders (docs/TEXT.md): wrapping, truncation and mixed runs.
// The right column wraps Overdrive's downloads notes as its 280 px text-sm boxes do at 1.5× (the
// layouts tools/test_text.py checks): lines break at spaces, CJK between characters.
import {AppRegistry, View, Text} from '@ps5-react/core';
import Inter from '../starter/assets/Inter-Regular.ttf';

const SAMPLES = [
  ['en', 'The quick brown fox jumps over the lazy dog. 0123456789'],
  ['zh-Hans', '敏捷的棕色狐狸跳过了那只懒狗。下载完成：24.2 GB，可以开始游戏了！'],
  ['hi', 'हिन्दी: क्षत्रिय, श्री, द्वार, कृष्ण — डाउनलोड पूरा हुआ।'],
  ['es', '¿Dónde está el pingüino? ¡Señor Muñoz, mañana! Ñandú, acción.'],
  ['ar', 'اكتمل تحميل اللعبة. PS5 تحميل 24.2 GB'],
  ['fr', 'Où est le cœur ? Ça coûte 12 € — garçon, naïve, Noël, « élève ».'],
  ['bn', 'বাংলা: আমি তোমাকে ভালোবাসি। ক্ষ, জ্ঞ, শ্রী — ডাউনলোড সম্পূর্ণ।'],
  ['pt-BR', 'Atenção: ação, coração, órgão, você, à toa, pôr do sol.'],
  ['ru', 'Съешь же ещё этих мягких французских булок, да выпей чаю.'],
  ['id', 'Unduhan selesai. Mainkan sekarang di PS5 Anda!'],
  ['ur', 'اردو: ڈاؤن لوڈ مکمل ہو گیا ہے۔ قیمت ۲۴٫۲ GB'],
  ['de', 'Zwölf Boxkämpfer jagen Viktor quer über den großen Sylter Deich.'],
  ['ja', 'いろはにほへと ちりぬるを。ダウンロード完了「日本語」、漢字かな交じり文。'],
];

const NOTES = [
  'पूरे गेम ShadowMount से इंस्टॉल होते हैं, जब कोई गेम खुला न हो। पूरा करने के लिए Overdrive बंद करें।',
  'कंसोल डाउनलोड खत्म होने तक जागृत रहता है।',
  'শেষ হওয়া গেম ShadowMount দিয়ে ইনস্টল হয়, যখন কোনো গেম খোলা থাকে না। শেষ করতে Overdrive বন্ধ করুন।',
  'কনসোল ডাউনলোড শেষ না হওয়া পর্যন্ত জেগে থাকে।',
  'تثبيت الألعاب المنتهية عبر ShadowMount، الذي ينتظر حتى عدم فتح أي لعبة. أغلق Overdrive لإنهاء.',
  'وحدة التحكم تبقى مستيقظة حتى اكتمال التحميلات.',
  'مکمل گیمز ShadowMount سے انسٹال ہوتی ہیں، جب کوئی گیم کھلی نہ ہو۔ مکمل کرنے کے لیے Overdrive بند کریں۔',
  '完了したゲームはShadowMountでインストールされ、ゲームが開いていない間に実行されます。Overdriveを終了すると完了します。',
  '已完成的游戏通过 ShadowMount 安装，它会等到没有游戏运行时才开始。请关闭 Overdrive 以让其完成。',
];

const label = {fontFamily: Inter, fontSize: 20, color: '#7f93a3', width: 90};
const sample = {fontFamily: Inter, fontSize: 26, color: '#f1f5f9', flexShrink: 1};
const note = {fontFamily: Inter, fontSize: 21, lineHeight: 30, color: '#f1f5f9', width: 420};

function App() {
  return (
    <View style={{width: 1920, height: 1080, backgroundColor: '#101820', padding: 40, gap: 40, flexDirection: 'row'}}>
      <View style={{flexGrow: 1, flexShrink: 1, gap: 14}}>
        {SAMPLES.map(([tag, text]) => (
          <View key={tag} style={{flexDirection: 'row', gap: 16, alignItems: 'flex-start'}}>
            <Text style={label}>{tag}</Text>
            <Text style={sample}>{text}</Text>
          </View>
        ))}
        <View style={{flexDirection: 'row', gap: 40}}>
          <Text style={{...sample, width: 420, backgroundColor: '#182630'}}>
            「こんにちは」と彼は言った。日本語の文章は、単語の間に空白がなくても折り返せます。
          </Text>
          <Text numberOfLines={2} style={{...sample, width: 420, backgroundColor: '#182630'}}>
            中文段落在任意两个汉字之间换行，但句号和逗号不会出现在行首。超出两行的文字以省略号结尾，这一句很长很长。
          </Text>
          <Text style={{...sample, width: 420, fontSize: 34, textAlign: 'center', backgroundColor: '#182630'}}>
            游戏库 · ゲーム · Games
          </Text>
        </View>
        <View style={{flexDirection: 'row', gap: 40}}>
          <View style={{direction: 'rtl', width: 560, gap: 8, backgroundColor: '#182630', padding: 8}}>
            <Text style={sample}>مكتبة الألعاب (٣) — PS5 تحميل 24.2 GB</Text>
            <View style={{flexDirection: 'row', gap: 8}}>
              {['١', '٢', '٣'].map(n => (
                <View key={n} style={{width: 60, height: 44, backgroundColor: '#294559', alignItems: 'center'}}>
                  <Text style={sample}>{n}</Text>
                </View>
              ))}
            </View>
            <Text numberOfLines={1} style={sample}>هذا نص عربي طويل جدا يجب أن ينتهي بعلامة حذف في نهايته اليسرى</Text>
          </View>
          <Text style={{...sample, width: 560, backgroundColor: '#182630'}}>
            Mixed: PS5 تحميل 24.2 GB, हिन्दी and বাংলা in one line.
          </Text>
        </View>
      </View>
      <View style={{width: 420, gap: 12}}>
        {NOTES.map(text => <Text key={text} style={note}>{text}</Text>)}
      </View>
    </View>
  );
}
AppRegistry.registerComponent('text-lab', () => App);
