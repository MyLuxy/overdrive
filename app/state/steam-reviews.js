import { useEffect, useState } from 'react';
import { FileSystem, Http } from '@ps5-react/core';
import { readJSON } from './read-json.js';

export var REVIEWS_DIR = `${FileSystem.dataDir}/overdrive/steam-reviews`;
var TTL_MS = 14 * 24 * 3600 * 1000;
var MAX_REVIEWS = 3;
var MAX_TEXT = 600;
var cache = {};

export function steamAppId(game) {
  try {
    const found = JSON.stringify(game.art || {}).match(/steam\/apps\/(\d{4,9})/);
    return found ? found[1] : null;
  } catch {
    return null;
  }
}

export function steamLanguage(locale) {
  return typeof locale === "string" && locale.toLowerCase().startsWith("ru") ? "russian" : "english";
}

export function normalizeReview(review) {
  if (!review || typeof review !== "object" || typeof review.review !== "string") return null;
  const text = review.review.trim().slice(0, MAX_TEXT);
  if (!text) return null;
  const author = typeof review.author === "object" && review.author !== null ? review.author : {};
  const minutes = author.playtime_at_review;
  const hours = typeof minutes === "number" && minutes > 0 ? Math.round(minutes / 60) : null;
  return {
    text,
    positive: review.voted_up === true,
    hours,
    votes: typeof review.votes_up === "number" && review.votes_up > 0 ? Math.floor(review.votes_up) : 0
  };
}

export function normalizeResponse(data) {
  const response = data && typeof data === "object" ? data.response : null;
  if (!response || !Array.isArray(response.reviews)) return null;
  const subject = { reviews: response.reviews.map(normalizeReview).filter(Boolean).slice(0, MAX_REVIEWS) };
  if (!subject.reviews.length) return null;
  const summary = response.query_summary;
  if (summary && typeof summary === "object") {
    if (typeof summary.review_score === "number" && summary.review_score >= 1 && summary.review_score <= 9) subject.score = summary.review_score;
    const total = summary.total_reviews;
    const positive = typeof summary.total_positive === "number" ? summary.total_positive : 0;
    if (typeof total === "number" && total >= 1) subject.percent = Math.max(0, Math.min(100, Math.round((positive / total) * 100)));
  }
  return subject;
}

async function fetchReviews(appId, language) {
  const url = `https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/?appid=${appId}&filter=recent&review_type=all&purchase_type=all&num_per_page=${MAX_REVIEWS}&language=${language}`;
  try {
    const response = await Http.request(url, { method: "GET", maxBytes: 262144 });
    if (!response.ok) return null;
    return normalizeResponse(await response.json());
  } catch {
    return null;
  }
}

async function load(appId, language) {
  const file = `${REVIEWS_DIR}/${appId}.json`;
  const valid = (value) => value && typeof value === "object" && typeof value.savedAt === "number" && Array.isArray(value.reviews);
  const saved = readJSON(FileSystem, file, null, valid, (message) => console.log(`[reviews] ${message}`));
  if (saved && Date.now() - saved.savedAt < TTL_MS) return saved;
  const fresh = await fetchReviews(appId, language);
  if (!fresh) return saved;
  const record = { ...fresh, savedAt: Date.now() };
  try {
    FileSystem.mkdir(REVIEWS_DIR, { recursive: true });
    FileSystem.writeFile(`${file}.tmp`, JSON.stringify(record), { sync: true });
    FileSystem.rename(`${file}.tmp`, file);
  } catch (error) {
    console.log(`[reviews] ${appId} not saved: ${error.message}`);
  }
  return record;
}

export function useSteamReviews(appId, language) {
  const [state, setState] = useState(() => (appId != null && cache[appId]) || null);
  useEffect(() => {
    if (appId == null) return void 0;
    const memory = cache[appId];
    if (memory) {
      setState(memory);
      return void 0;
    }
    let alive = true;
    load(appId, language)
      .then((value) => {
        if (!value || !alive) return;
        cache[appId] = value;
        setState(value);
      })
      .catch(() => { });
    return () => {
      alive = false;
    };
  }, [appId, language]);
  return state;
}
