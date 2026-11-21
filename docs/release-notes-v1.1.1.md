More games and the right archive passwords.
- New: 94 games and 51 alternate editions
- Fixed: The Knight Witch archive password
- Improved: 70 known archive passwords

**New to Overdrive?** Download `Overdrive.exfat` below and follow the [install guide](https://gitlab.com/myluxy/overdrive#install-in-four-steps).

### New
- **94 games and 51 alternate editions** from Pegasus and SuperPSX join the built-in catalog. Alternate platform editions stay grouped with their existing game.
- **Updated download sources and game details.** Newly imported entries include the available artwork, descriptions, screenshots, genres and release information.

### Fixed
- **The Knight Witch:** its archive password is `(DLPSGAME.COM)`, including the parentheses. Its release now carries that password explicitly.
- **More archive passwords:** 62 additional published passwords join the previous eight, for 70 automatic fallback candidates. Exact case, spaces, brackets and numeric suffixes are preserved.
- The catalog enrichment tool now refreshes expired title-list caches without failing on an undefined source URL.

### Improved
- Published archive passwords were checked across the source feeds and relevant DLPS pages; additional SuperPSX variants were confirmed on their download pages.
- New-game and source imports now have a documented requirement to collect archive passwords and record their provenance.

### Validation
- This exact build was compiled on the VPS, verified against its build receipt, and reported working on PS5 by the maintainer.
- The image uses 8 KiB exFAT clusters. The `update.zip` download contains `Overdrive.exfat` at its root.
