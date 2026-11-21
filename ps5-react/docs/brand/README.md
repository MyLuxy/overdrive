# PS5 React brand assets

`logo.png` is the original project mark: a blue display containing JSX brackets
and a framebuffer pixel. It identifies the independent framework and contains
no official PlayStation insignia or React atom mark.

## Usage

Use the transparent PNG against light or dark surfaces. Keep its proportions
and surrounding clear space; do not stretch it or add glow/shadow effects.
The README displays it at 160 pixels wide with a separate text heading, keeping
the project name accessible and readable in either GitHub theme.

The asset follows the repository's framework license and attribution terms;
preserve `NOTICE` when redistributing it with the framework.

## Design direction

The README uses GitHub's native typography and code blocks. The visual research
was grounded in Refero style references:

- [shadcn/ui](https://ui.shadcn.com): clear hierarchy and restrained decoration.
- [SST](https://sst.dev): code examples as the main explanatory visual.
- [cthdrl](https://cthdrl.co): geometric framing and spacious brand composition.

Reference lock: a compact geometric mark, a single blue ink color, transparent
background, readable native headings, and practical code examples. No decorative
banner, unofficial hardware screenshot or compatibility badge is used.

## Generation provenance

Created with the built-in `imagegen` tool. Earlier cyan explorations were
rejected because they introduced excessive glow. The production PNG is the
flat blue alternative; it was visually inspected and its alpha channel checked.

Final generation prompt:

```text
A professional 2D FLAT INK LOGO, not a neon sign. Transparent background PNG, absolutely NO BLACK BACKGROUND and NO GLOW. Imagine a precisely cut single-color blue vinyl sticker. ONE small cohesive symbol: a simple widescreen monitor outline whose left and right sides are angular JSX chevrons, with one small square in the middle. SOLID MATTE DARK BLUE #2165b5 for all filled strokes. Large clean empty transparent margins. Geometric engineering, balanced horizontal symmetry, crisp silhouette, thick uniform stroke width, subtle small rounded corners. All interiors and the entire background are completely transparent with alpha zero. Flat vector design, minimal SVG-like geometry, NO 3D, NO lighting, NO gradients, NO texture, NO cyan haze, NO shadows, NO reflections, NO lettering, NO watermark, NO official PlayStation logos, NO React atom. Deliver one icon centered in a square transparent canvas, immediately suitable as an open-source framework README logo.
```
