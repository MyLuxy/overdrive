# Overdrive project instructions

## Importing games and sources

- Every new game, edition, download source, or refreshed source must also be checked for its published archive passwords. Do not import download links alone.
- Read password metadata from the current feeds and the original release/download pages, including relevant author corrections. Decode publicly embedded page content when necessary and distinguish archive passwords from account credentials, link-lock passwords, and descriptive text.
- Preserve password case, spaces, brackets, parentheses, symbols, and numeric suffixes exactly. Split explicit alternatives such as "hako or ByAlvRo" into separate candidates; discard surrounding formatting and false positives.
- Save a confirmed password as `archivePassword` on the corresponding release or archive-volume sources when the association is unambiguous. A page may contain several editions, regions, mirrors, or updates with different passwords: never assign one password to every link without evidence.
- Add newly published archive-password candidates to `KNOWN_PASSWORDS` in `app/state/download-queue.js`, retaining and deduplicating the existing values. Preserve verified per-release password metadata when rebuilding importer-owned records.
- Record the password's source and affected game in `docs/archive-passwords.md` and `docs/archive-passwords.json`. Distinguish confirmation of a published value from successful extraction of an actual archive.
- Before a build that includes newly imported games or sources, finish this password check and run the relevant download-queue password tests. Cover exact punctuation/case, metadata-first extraction, fallback candidates, and stopping on errors unrelated to passwords.

## Local test builds

- Keep the requested application version when rebuilding a test artifact. Stamp each build with its source identity and UTC build time so successive builds of the same version can be distinguished.
- Build using the dedicated Overdrive Docker environment on the configured VPS. Keep source snapshots isolated from live services.
- Verify binary integrity, ZIP integrity, artifact hashes, and packaged files against the build receipt before replacing local test artifacts.

## PS4 port

- This repository is the PS4 port of Overdrive; the PS5 pipeline in `packaging/build.sh`
  and `ps5-react/native/ps5` stays the reference implementation, not the build target.
- PS4-specific code lives only in `ps5-react/native/ps4` and `ps5-react/tools/build_ps4.py`;
  it is compiled with the Open Orbis toolchain (`OO_PS4_TOOLCHAIN`) through
  `npm run build:ps4`. See `docs/PS4.md` for the plan and the console bring-up checklist.
- Do not mark PS4 artifacts as hardware-tested; every PS4 build stays untested until a
  console session says otherwise.
- Keep the PS4 host mirroring `native/desktop` when the shared behavior is identical;
  diverge only where the console requires it (no processes, no `/proc/self/mounts`).
