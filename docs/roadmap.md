# Roadmap

Planned features, in no particular order. Both ideas below are approved directions; neither has
been started.

## PS Store charts as a Discover showcase

Build a live "Popular on PS Store" section for the Discover page from the official store charts
(top sellers, new releases), fetched with the same GraphQL chain the trailer and rating scanners
use (`x-psn-store-locale-override` header, concept/product queries).

- No new catalog data: the charts arrive at runtime and refresh on their own, so the store front
  keeps changing between launches without a new data dump.
- Map chart entries onto the local catalog by product id; games that are missing from the dump
  are skipped, not fetched on demand.
- Respect the existing locale handling: charts follow the console's store region, falling back to
  the bundled catalog order when the request fails.
- Keep it a suggestion surface only — no auto-download, cards behave like every other Discover
  entry.

## Theme sharing by QR code

The blocked "theme by URL" idea, unblocked by removing typing from the loop: the console has no
IME, so instead of entering a URL, the console shows it.

- A theme page in the app (or the theme detail dialog) renders a QR code with the theme's URL —
  a file hosted on the site's theme gallery (`https://stintik-123.github.io/Overdrive/`).
- The user scans it with a phone, opens the link, and the phone-side page offers one of two ways
  in: either the phone pushes the JSON to the console over the local network (the app listens on
  a short-lived port and shows the code again to confirm), or the user downloads the file and
  sends it to `/data/overdrive/themes/` over the same FTP they already use.
- No auth, no accounts: the QR encodes a plain URL, and the console side only accepts content
  that passes the existing theme loader validation (palette keys, wallpaper field, dim range).
- A QR renderer is not a blocker: `app/third_party/qrcodegen.js` already ships with the app and
  `app/ui/QRCode.jsx` renders it, so reusing that component on the theme page keeps the console
  side free of anything new.
