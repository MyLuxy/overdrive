Overdrive v1.1.2 expands the catalog and improves game discovery, download capture, and the GTA VI hero.

### Catalog
- Added 294 catalog entries, including Pegasus and SuperPSX imports, with new detail pages and download records.
- Refreshed existing source records and archive-password metadata; the SuperPSX importer now handles its redesigned frontend and password sections.

### Fixed and improved
- GTA VI is the first featured game in the home carousel. Its bundled logo now appears immediately, and the hero description no longer waits for a remote-image load event.
- VikingFile capture accepts the OVH SBG storage redirects used by its download links.
- Disabled scheduled catalog imports on GitHub; the workflow remains available for manual runs.

### Install and update
- Download `Overdrive.exfat` for a new installation.
- The in-app updater downloads `update.zip`, which contains the `.exfat` image at its root. GitHub and GitLab both carry the v1.1.2 update.

### Validation
- Built on the VPS. The PS5 title verifier passed, the exFAT image passed `fsck.exfat`, and all 8,813 packaged files were checked.
- The maintainer tested this build successfully on PS5.
