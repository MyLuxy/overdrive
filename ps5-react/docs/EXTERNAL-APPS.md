# External applications

Keep application JSX, assets and configuration in your own repository. The PS5
React checkout owns the host, bundler, dependency cache and build output.

## Scaffold and run

From the framework root:

```sh
npm run create -- --name my-store --title-id PPSA99101 --dir ../my-projects
npm run dev -- --app-dir ../my-projects/my-store
npm run build -- --app-dir ../my-projects/my-store
```

Choose a unique title ID and a directory name that does not match an app in
`apps/`. The scaffold creates `app.json`, an entry point, assets and theme/font
configuration. External applications resolve React and `@ps5-react/core` through
the framework bundler without installing a separate `node_modules`.

Build output remains in the framework's `.build/<directory-name>/` and
`dist/<TITLE_ID>/`. The watcher ignores the external app's `.git/` and
`node_modules/`. Saving sources rebuilds and restarts the preview; state resets.

## Editor configuration

Add `jsconfig.json` to the external application's root. Adjust the paths below
to match the location of your framework checkout. For a layout with
`ps5-react/` and `my-projects/my-store/` alongside it:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@ps5-react/core": ["../../ps5-react/runtime/js/index.js"],
      "embedded-react": ["../../ps5-react/.deps/embeddedReact/bridges/quickjs/js/src/embedded-react/index.d.ts"],
      "react": ["../../ps5-react/node_modules/@types/react"],
      "react/*": ["../../ps5-react/node_modules/@types/react/*"]
    }
  },
  "include": ["**/*.jsx", "**/*.js", "../../ps5-react/runtime/js/**/*.d.ts"]
}
```

Run the framework's dependency setup and first preview before expecting
dependency-backed editor paths to exist. The editor mappings are for source
navigation and IntelliSense; the framework bundler supplies runtime resolution.

## Read-only package data

Add `"resources": ["data/releases"]` to app.json to copy an app-relative data
file or directory into the application folder. Read it with
`FileSystem.readFile('/app0/data/releases/example.json')` on either host.
Resources stay outside the JavaScript bundle until your application reads them;
readFile's 8 MiB per-file limit still applies. Generate resources before preview
or build. Symlinks, traversal and package infrastructure paths are rejected.
Files are hashed in the build receipt. Data is read-only through `/app0`.
