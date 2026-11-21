# Agent instructions

## Project purpose

PS5 React lets developers build standalone, fullscreen PS5 homebrew applications
with React/JSX and controller input. Preserve a short path from JSX editing to
native macOS preview and a PS5 application-folder build.

Read `README.md`, `CONTRIBUTING.md`, and the relevant files under `docs/` before
changing architecture or platform behavior. Keep repository documentation,
comments, user-visible text, and commit messages in English.

## Architectural boundaries

- `apps/<app>/`: application JSX, state, manifest, assets, and font configuration.
- `runtime/js/`: public API and controller subscriptions.
- `native/shared/`: platform-independent framebuffer presentation.
- `native/desktop/` and `native/ps5/`: platform lifecycle, graphics context, and input.
- `tools/`: dependency bootstrap, bundling, asset baking, builds, and verification.

React runs through QuickJS and Embedded React. The software backend rasterizes
the UI; OpenGL presents the framebuffer as a texture. Do not describe this as
direct GPU UI rendering or the complete official React Native runtime.

Use ps5-homebrew-ui only for execution/platform infrastructure. Do not import its
widgets, themes, or UI renderer. Do not introduce Sony RNPS hooks, replace system
applications, or modify the console's system UI.

Keep engine and JavaScript work on the render thread. Preserve resource cleanup,
controller subscription cleanup, explicit exit behavior, and heap/stack budgets.
Explain changes to those contracts and validate them before broadening scope.

## Developer workflow

```sh
npm ci
npm run doctor
npm run dev
npm test
npm run build
```

See the README for native prerequisites and Python environment setup. The
watcher rebuilds and restarts the app; state resets. It is not Fast Refresh.

Use `npm run create -- --name my-app --title-id PPSA99054` to scaffold an app.
Apps should not require copied hosts or edits to C++ for ordinary UI changes.
Apps navigate with focusable elements, `onPress`, and `FocusScope`
(`docs/NAVIGATION.md`), not manual focus indices driven by `useController`.
Keep configuration errors actionable and report them before expensive builds.

## Validation and hardware claims

- Run `npm test` for rendering, JavaScript runtime, or input changes. It currently
  exercises the starter, with simulated controller input.
- Run `npm run build` for PS5 host, tooling, dependency, or packaging changes.
- For documentation-only changes, check accuracy, links, and formatting; native
  builds are unnecessary unless a documented behavior is uncertain.
- Record hardware evidence for the exact artifact, firmware, and loader. Desktop
  tests and ELF/SELF checks do not establish PS5 execution.
- Update the changelog and documentation when public behavior or setup changes.

The confirmed baseline is the original PPSA99052 proof of concept. The initial
PPSA99053 framework starter has not yet been independently hardware-tested.
Consult `docs/HARDWARE.md`; do not change `hardware_tested` based on inference.
Do not claim measured FPS or universal firmware compatibility without evidence.

Build and preview tools do not access the console. Console upload, launch, or
other live-device operations require explicit task authorization.

## Native API contract

`native/shared/host_api.hpp` defines `globalThis.__ps5ReactNative` (its header names the ABI version);
`runtime/js/native.js` is its only consumer and `docs/NATIVE-API.md` its public
reference. Change all three together, implement every function on both hosts,
keep calls synchronous, cheap, and on the render thread, and throw errors that
name the call and path. Apps use the `@ps5-react/core` modules, never the global.
Do not claim a call works on PS5 without evidence in `docs/HARDWARE.md`.

## Dependencies and licensing

Pin dependency revisions and download hashes in `dependencies.lock.json`.
Change a pinned dependency only through a reviewed file in `patches/` listed in
the lock file; propose the same change upstream and drop the patch once pinned.
Preserve upstream copyright and license notices. Framework-owned material uses
GPL-3.0-or-later with the attribution-preservation term in
`LICENSE-ATTRIBUTION`; preserve `NOTICE` in redistributions. Third-party material
retains its own license, including the Apache-2.0 adaptation in `tools/bundle.mjs`.

Do not commit `.deps/`, `.build/`, `dist/`, `node_modules/`, SDK archives,
generated binaries, credentials, console addresses, or personal machine paths.
The initial public release is source-only. Before distributing binaries, follow
the corresponding-source and notice requirements in `docs/DEPENDENCIES.md`.

## Utility-class styling

`className` and `tw` support a subset of Tailwind CSS v3 utilities, compiled by
`tools/tailwind` at build time into literal, render-width-scaled style objects.
`docs/TAILWIND.md` is the supported-utility reference; update it with any change.

- Keep CSS parsing and class compilation out of the PS5 runtime.
- Explicit `style` wins; later classes win; unsupported classes, variants, and
  runtime-computed class names fail the build with a source location and reason.
- State variants read props of the same name; prop expressions must stay pure.
- Add a utility only when the engine honors it; otherwise reject it with a reason.
- Do not claim full Tailwind compatibility. Run `npm test` after changes and keep
  starter snapshots pixel-identical to explicit styles.

## Change discipline

Keep changes focused, favor shared contracts over platform duplication, and
avoid new abstractions without a concrete use. Report what changed, the checks
that actually ran, and any remaining hardware-validation gap. Do not publish a
release or contact upstream maintainers unless the task authorizes it.
