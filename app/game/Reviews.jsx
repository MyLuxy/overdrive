import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { LATIN_IN_RTL, useLocale, useT } from '../i18n/index.js';
import { steamAppId, steamLanguage, useSteamReviews } from '../state/steam-reviews.js';
import { Text, View } from '@ps5-react/core';

var CARD = { width: 900, gap: 14, padding: 24, backgroundColor: "#17171a", borderRadius: 12 };
var POSITIVE = "#8fd6a5";
var NEGATIVE = "#e08f8f";

function Reviews({ game }) {
  const t2 = useT();
  const { rtl, locale } = useLocale();
  const record = useSteamReviews(steamAppId(game), steamLanguage(locale));
  if (!record) return null;
  const latin2 = rtl ? LATIN_IN_RTL : void 0;
  const title = typeof record.score === "number" ? t2(`reviews.score${record.score}`) : "";
  return (0, jsxs)(View, { scrollAnchor: true, style: { gap: 24 }, children: [
    (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 18 }, children: [
      (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 30, fontWeight: 600, color: "#f2f2f3", lineHeight: 42, letterSpacing: -0.75 }, children: t2("game.reviews") }),
      record.percent !== undefined ? (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, children: t2("reviews.of", { percent: String(record.percent) }) }) : null,
      title ? (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 21, color: record.score >= 6 ? POSITIVE : record.score <= 4 ? NEGATIVE : "#a3a3ab", lineHeight: 30 }, latin2], children: title }) : null
    ] }),
    record.reviews.map((review, index) => (0, jsxs)(View, { style: CARD, children: [
      (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 22, color: "#a3a3ab", lineHeight: 34 }, latin2], numberOfLines: 8, children: review.text }),
      (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 14 }, children: [
        (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 19, color: review.positive ? POSITIVE : NEGATIVE, lineHeight: 30 }, children: t2(review.positive ? "reviews.good" : "reviews.bad") }),
        review.hours !== null ? (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 19, color: "#8a8a94", lineHeight: 30 }, children: t2("reviews.hours", { hours: String(review.hours) }) }) : null,
        review.votes > 0 ? (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 19, color: "#8a8a94", lineHeight: 30 }, children: t2("reviews.votes", { votes: String(review.votes) }) }) : null
      ] })
    ] }, index))
  ] });
}

export { Reviews };
