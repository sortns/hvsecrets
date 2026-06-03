# AMO Source Build Instructions

These instructions reproduce the submitted HVSecrets extension package from source.

## Build Environment

- Operating system: Linux, macOS, or Windows with a POSIX-compatible shell
- Node.js: 20 or newer
- npm: bundled with Node.js

The submitted version is built with the dependency versions pinned in `package-lock.json`.

## Build Steps

From the repository root:

```sh
npm ci
npm run build
npm run web-ext:lint
npm run web-ext:build
```

The extension package is generated in:

```text
web-ext-artifacts/hvsecrets-0.0.1.zip
```

## What The Build Does

`npm run build` runs TypeScript type checking and the Vite production build.

Vite reads:

- `popup.html`
- `options.html`
- `src/background/index.ts`
- `src/content/index.ts`
- `src/popup/index.ts`
- `src/options/index.ts`
- `public/manifest.json`
- `public/icons/*`

and writes the generated extension files to `dist/`.

`npm run web-ext:build` packages `dist/` into the final extension ZIP.

## Validation

Run:

```sh
npm run lint
npm run test
npm run web-ext:lint
```

Expected result:

- ESLint passes
- Vitest unit tests pass
- `web-ext lint` reports 0 errors and 0 warnings

## Source Archive For AMO

Commit the source first, then create the source archive from the committed tree:

```sh
git archive --format=zip --output hvsecrets-source-0.0.1.zip HEAD
```

Upload `hvsecrets-source-0.0.1.zip` in AMO's source code upload field.

Do not upload `dist/`, `node_modules/`, or `web-ext-artifacts/` as source. Those are generated files or installed dependencies.
