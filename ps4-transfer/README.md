# PS4 transfer instructions (for the next AI session / for a human)

> Цель: перенести готовое состояние PS4-порта из этого репозитория в
> https://github.com/Stintik-123/Overdrive-PS4 , после чего удалить эту папку.
> This file is a hand-off note. Read it fully, then follow Step 1 → 4. Delete this
> folder (`ps4-transfer/`) at the very end (Step 4).

The full, intended state of the Overdrive-PS4 repository `main` was prepared in this
repository as branch `vibe/overdrive-ps4-port-fd5b99` (also open as PR #3). It contains:
the complete Overdrive codebase + the PS4 native host (`ps5-react/native/ps4/`) + the
PS4 build pipeline (`ps5-react/tools/build_ps4.py`, `packaging/build-ps4.sh`,
`npm run build:ps4`) + `docs/PS4.md` (environment setup and the console bring-up
checklist) + the finished `README.md` / `README.ru.md` / `AGENTS.md` / `package.json`
+ the GPL-3.0 `LICENSE`.

## Step 1 — take the source state

Two valid sources exist. Pick the one that matches reality:

- **PR #3 is still open** → transfer from its branch:
  ```sh
  git clone https://github.com/Stintik-123/Overdrive-PS4
  cd Overdrive-PS4
  git fetch https://github.com/Stintik-123/Overdrive.git vibe/overdrive-ps4-port-fd5b99
  ```
- **PR #3 was merged into this repository's main** → transfer from `main` directly:
  ```sh
  git clone https://github.com/Stintik-123/Overdrive-PS4
  cd Overdrive-PS4
  git fetch https://github.com/Stintik-123/Overdrive.git main
  ```

…then run the same `git reset --hard FETCH_HEAD && git push origin main` as Step 2
regardless of which source you took.

## Step 2 — replace Overdrive-PS4 main with that state

The placeholder commit in Overdrive-PS4 (Initial commit, LICENSE + README stub) is
superseded: the source carries its own `LICENSE` and finished READMEs. Rewriting the
local main before any push is expected here.

```sh
git reset --hard FETCH_HEAD
git push origin main
```

If the push is refused on protected-branch grounds, push the branch instead and merge
via the GitHub UI:

```sh
git push origin FETCH_HEAD:refs/heads/ps4-port-base
# then open a PR from ps4-port-base into main in Overdrive-PS4 and merge it
```

## Step 3 — verify

- `ls` shows the full tree: `app/`, `ps5-react/`, `packaging/`, `tools/`, `docs/PS4.md`,
  `docs/archive-passwords.json`, `covers/`, `README.md`, `README.ru.md`, `LICENSE`.
- `ls ps5-react/native/ps4/` shows exactly: `CMakeLists.txt`, `README.md`,
  `browser_capture.cpp`, `host_platform.cpp`, `package_installer.cpp`,
  `rar_worker_process.cpp`, `toolchain-openorbis.cmake`.
- `package.json` has the `build:ps4` script; `docs/PS4.md` exists at the root of docs/.
- `git log --oneline -3` on Overdrive-PS4 shows history ending in the merge commit
  "merge: seed the PS4 port repository from Overdrive main" and
  "ps4: add the native host, the Open Orbis build pipeline and the repository docs".

## Step 4 — clean up this repository (Stintik-123/Overdrive)

1. Delete the `ps4-transfer/` folder (this file included) with a commit like
   `transfer: remove the ps4-transfer hand-off note (applied to Overdrive-PS4)` on `main`.
2. If PR #3 is still open and its content is already in Overdrive-PS4, close it (the branch
   `vibe/overdrive-ps4-port-fd5b99` is disposable); if it was merged instead, just delete
   the branch or leave it as history.

## Context, in one paragraph

The sandbox session that wrote the PS4 port could not push to Overdrive-PS4 (the session
only had Overdrive), so the port was parked on this branch. Everything PS4-side is
written but **never compiled**: there is no Open Orbis toolchain in the sandbox. The next
steps after the transfer are in `docs/PS4.md`: set up the Open Orbis toolchain
(`OO_PS4_TOOLCHAIN`), run `npm run setup && npm run preview` as the sanity check, then
`npm run build:ps4`, fix compile errors as they surface, and follow the console
bring-up checklist with a physical jailbroken PS4 (firmware notes and the full test pass
are in `docs/PS4.md`).
