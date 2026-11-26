# Customization audit

Audited 2026-11-26 from source, after the question "is themes really all the customization?".

## What the Settings page exposes

Four groups, eleven tiles (`app/ui/settings-data.js`):

| Group | Tile | Values |
|---|---|---|
| General | Vibration | several intensity levels with a live preview |
| General | Language | full locale list, a "system" option, RTL previews for Arabic/Urdu |
| Appearance | Themes | built-in default + user themes from `/data/overdrive/themes/` |
| Downloads | Speed limit | several caps, with a "50 GB at this speed = 1 h 19 min" side panel |
| Downloads | Disk for downloads | auto or a specific drive |
| Downloads | PKG mode | ask / console / Overdrive (the fast path) |
| Downloads | Delete packages | auto-cleanup on/off |
| Services | TorBox / Real-Debrid / Premiumize | API key, or phone QR login (`device-login.js`), unlink |
| Services | qBittorrent | address, user, password |

## What a theme carries today

Twelve palette colors, an optional wallpaper (file or URL) with dimming, alpha in every color
(glass). See [themes.md](themes.md).

## Hidden customization — real features nobody sees in Settings

1. **Lightbar follows the cover.** `app/ui/lightBar.js` paints the controller's light bar with the
   average color of the focused game's cover, and resets it on unfocus.
2. **Wallpapers by URL.** `safeBackdrop` accepts `http(s)` image URLs, so a theme is one shareable
   `.json` file even with a wallpaper.
3. **Interface sounds with stereo paging.** `app/ui/sounds.js` plays focus/confirm/error/notify
   sounds and pans page-turn sounds left (L1/L2) or right (R1/R2).
4. **RTL from the root.** Arabic and Urdu mirror every row via `direction` at the app root.

## Personalization outside Settings

Favorites with several kinds (`favorite-kinds.js`, `WishHeart`), recents (`recent.js`).

## Gaps — cheap, high-value settings candidates for 1.1.3

| Missing | Why it matters |
|---|---|
| Interface sounds on/off or volume | Night playing, family, accessibility |
| Lightbar mode (cover / fixed / off) | The feature exists but is invisible and uncontrolled — [Theme Engine 2.0](theme-engine-2.md) adds the setting |
| Trailer autoplay (on / off / Wi-Fi only) | Trailers are new (v1.1.2) and consume traffic |
| Cover size / grid density | The first real "view" customization |
| Reduced motion | Accessibility; the scene asks for it |
| Accent color override | One knob that makes the store feel "mine" |

## Verdict

"Themes and that's it" is wrong: eleven settings in four groups, 12-color themes with wallpapers
and glass, 17+ languages with RTL, vibration, speed limits, disk choice, PKG modes, auto-cleanup,
four linked services with QR login — plus three undocumented features. What is genuinely thin is
surface-level control (density, motion, sound, lightbar), and that is exactly what
[Theme Engine 2.0](theme-engine-2.md) opens up.
