// ---------------------------------------------------------------------------
// HERO BACKGROUND: black by default. To use a trailer, put either a file URL
// (.mp4 / .webm) or a YouTube video ID (11 characters) below.
//   const HERO_VIDEO = 'trailer.mp4';
//   const HERO_VIDEO = 'dQw4w9WgXcQ';
// ---------------------------------------------------------------------------
const HERO_VIDEO = '';

(function heroVideo() {
  const bg = document.getElementById('hero-bg');
  if (!bg || !HERO_VIDEO) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let el;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(HERO_VIDEO)) {
    el = document.createElement('video');
    Object.assign(el, { src: HERO_VIDEO, autoplay: true, muted: true, loop: true, playsInline: true });
    el.setAttribute('muted', ''); el.setAttribute('playsinline', '');
    el.addEventListener('canplay', () => bg.classList.add('on'), { once: true });
  } else {
    el = document.createElement('iframe');
    const id = HERO_VIDEO.trim();
    el.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&loop=1&playlist=${id}&modestbranding=1&playsinline=1&rel=0&disablekb=1`;
    el.allow = 'autoplay; encrypted-media';
    el.tabIndex = -1;
    el.addEventListener('load', () => setTimeout(() => bg.classList.add('on'), 600), { once: true });
  }
  bg.appendChild(el);
})();

// ---------------------------------------------------------------------------
// Site behaviour: language + theme switches, nav, reveal, theme gallery.
// ---------------------------------------------------------------------------
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const root = document.documentElement;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: ignore */ } },
};
const I18N = window.I18N || { en: {}, ru: {} };
const THEMES = (window.THEMES_INDEX && window.THEMES_INDEX.themes) || [];

let lang = root.lang === 'ru' ? 'ru' : 'en';
const t = (key) => (I18N[lang] && I18N[lang][key]) ?? (I18N.en && I18N.en[key]) ?? key;

// ----- toast
const toast = $('.toast');
let toastTimer;
function say(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ----- reveal on scroll
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
$$('.reveal').forEach((el) => io.observe(el));

// ----- copy buttons (delegated, so re-rendered gallery buttons work too)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const text = btn.getAttribute('data-copy');
  const okKey = btn.hasAttribute('data-copy-path') ? 'toast.pathcopied' : 'toast.copied';
  try { await navigator.clipboard.writeText(text); say(t(okKey)); }
  catch { say(t('toast.copyfail')); }
});

// ----- theme download: build the file in the browser, so it works hosted, from a zip, or as one HTML file
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-dl]');
  if (!a) return;
  const th = THEMES.find((x) => x.id === a.getAttribute('data-dl'));
  if (!th || !th.json) return;            // no data: let the plain link work
  e.preventDefault();
  const blob = new Blob([JSON.stringify(th.json, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = th.id + '.json';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
});

// ----- theme gallery + swatches (data comes from themes-data.js)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const textOn = (hex) => {
  const h = hex.replace('#', '').slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? '#000' : '#fff';
};

function renderGallery() {
  const gallery = $('#theme-gallery');
  if (!gallery) return;
  if (!THEMES.length) { gallery.innerHTML = `<p class="sub">${esc(t('gal.loadfail'))}</p>`; return; }
  gallery.innerHTML = THEMES.map((th) => `
    <article class="theme reveal in">
      <div class="preview" style="background:${esc(th.canvas)};--pf:${esc(th.fg)}">
        <div class="top" style="color:${esc(th.muted)}"><span>Overdrive</span><span class="pill" style="background:${esc(th.fg)};color:${textOn(th.fg)}">Install</span></div>
        <div class="row">
          <div class="tile focus" style="background:${esc(th.surface)};color:${esc(th.fg)}"><b>${esc(t('gal.game'))}</b><small style="color:${esc(th.muted)}">Action · 12 GB</small></div>
          <div class="tile" style="background:${esc(th.surface)};color:${esc(th.fg)}"><b>${esc(t('gal.game'))}</b><small style="color:${esc(th.muted)}">RPG · 4 GB</small></div>
        </div>
        <div class="bar" style="background:${esc(th.surface)}"><i style="background:${esc(th.accent)}"></i></div>
      </div>
      <div class="theme-body">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <h3>${esc(th.name)}</h3>
          <div class="palette-dots" aria-hidden="true"><i style="background:${esc(th.canvas)}"></i><i style="background:${esc(th.surface)}"></i><i style="background:${esc(th.fg)}"></i><i style="background:${esc(th.accent)}"></i></div>
        </div>
        <p>${esc(lang === 'ru' ? th.description_ru : th.description)}</p>
        <div class="theme-actions">
          <a class="btn btn-primary" href="${esc(th.file)}" download="${esc(th.id)}.json" data-dl="${esc(th.id)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            ${esc(t('gal.download'))}
          </a>
          <button class="btn btn-ghost" data-copy="/data/overdrive/themes/${esc(th.id)}.json" data-copy-path type="button">${esc(t('gal.path'))}</button>
        </div>
      </div>
    </article>`).join('');
}

function renderSwatches() {
  const el = $('#swatches');
  if (!el) return;
  el.innerHTML = THEMES.map((th) => `<div class="swatch" style="background:${esc(th.surface)}"><div style="position:absolute;inset:0 0 40% 0;background:${esc(th.canvas)}"></div><div style="position:absolute;left:12%;right:12%;bottom:24%;height:22%;border-radius:8px;background:${esc(th.surface)};border:1px solid rgba(255,255,255,.06)"></div><span>${esc(th.name)}</span><div style="position:absolute;right:8px;top:8px;width:10px;height:10px;border-radius:50%;background:${esc(th.info || th.accent)}"></div></div>`).join('');
}

// ----- language
function applyLang(next, persist) {
  lang = next === 'ru' ? 'ru' : 'en';
  root.lang = lang;
  const dict = I18N[lang] || {};
  $$('[data-i18n]').forEach((el) => {
    const v = dict[el.getAttribute('data-i18n')];
    if (v !== undefined) el.innerHTML = v;
  });
  for (const attr of ['alt', 'aria-label', 'title']) {
    $$(`[data-i18n-${attr}]`).forEach((el) => {
      const v = dict[el.getAttribute(`data-i18n-${attr}`)];
      if (v !== undefined) el.setAttribute(attr, v);
    });
  }
  const page = root.getAttribute('data-page') || 'home';
  document.title = t(`meta.title.${page}`);
  const desc = $('meta[name="description"]');
  if (desc) desc.setAttribute('content', t(`meta.desc.${page}`));
  renderGallery();
  if (persist) store.set('od-lang', lang);
}
const langBtn = $('#lang-toggle');
if (langBtn) langBtn.addEventListener('click', () => applyLang(lang === 'en' ? 'ru' : 'en', true));

// ----- light / dark theme (initial value is set in <head> from the device preference)
function applyTheme(next, persist) {
  const theme = next === 'light' ? 'light' : 'dark';
  root.setAttribute('data-theme', theme);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#fafafa' : '#07070a');
  if (persist) store.set('od-theme', theme);
}
const themeBtn = $('#theme-toggle');
if (themeBtn) themeBtn.addEventListener('click', () => applyTheme(root.getAttribute('data-theme') === 'light' ? 'dark' : 'light', true));
try {
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!store.get('od-theme')) applyTheme(e.matches ? 'light' : 'dark');
  });
} catch { /* old browsers: ignore */ }
applyTheme(root.getAttribute('data-theme'));

// ----- nav state + mobile menu
const nav = $('.nav');
const onScroll = () => nav && nav.classList.toggle('scrolled', scrollY > 24);
addEventListener('scroll', onScroll, { passive: true }); onScroll();
const menuBtn = $('.menu-btn'), menu = $('.nav ul');
if (menuBtn && menu) {
  menuBtn.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) { menu.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); } });
}

// ----- first render
renderSwatches();
applyLang(lang);
