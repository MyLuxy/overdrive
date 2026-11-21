# Contributing

Start with `npm ci`, `npm run doctor`, and `npm test`. See the README for
native prerequisites and the macOS setup. Keep documentation, comments,
commit messages, and user-visible text in English.

## Scope

Keep application UI in JSX, shared presentation in `native/shared`, and platform
lifecycle/input in the hosts. Do not introduce Sony RNPS hooks or changes to
system applications. Preserve the distinction between software rasterization
and OpenGL presentation.

## Changes and validation

1. Make one focused change and explain its observable behavior.
2. Run the desktop test for rendering, runtime, or input changes.
3. Run `npm run build` for PS5 host, tooling, or packaging changes.
4. Record actual hardware results for the exact artifact and firmware/loader.
5. Update documentation and the changelog when behavior or setup changes.

Never mark a build hardware-tested based only on desktop tests. Do not commit
SDK archives, dependency caches, generated binaries, credentials, or machine
paths. Preserve upstream notices when adapting code.

## License

Contributions to framework-owned code are submitted under GPL-3.0-or-later
with the attribution-preservation term in LICENSE-ATTRIBUTION. Contributions
to separately licensed material retain that material's applicable license.
