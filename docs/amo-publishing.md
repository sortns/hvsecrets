# AMO Publishing

Firefox release and beta builds require extensions to be signed by Mozilla. There are two practical release channels:

- `listed`: published on addons.mozilla.org (AMO). Users install it from the AMO add-on page, and Firefox receives updates from AMO.
- `unlisted`: signed by AMO but distributed by us. Users install the signed `.xpi` from a GitHub release or another internal location. It does not appear on AMO.

Use `unlisted` for internal testing. Use `listed` when the extension should be installable from the Firefox Add-ons website.

## One-Time AMO Setup

1. Create or log in to a Mozilla account.
2. Open the Add-ons Developer Hub.
3. Generate API credentials from the AMO credentials page.
4. Add these GitHub repository secrets:
   - `AMO_JWT_ISSUER`: the AMO JWT issuer.
   - `AMO_JWT_SECRET`: the AMO JWT secret.
5. Add this optional GitHub repository variable:
   - `AMO_CHANNEL`: `unlisted` or `listed`. If omitted, the workflow uses `unlisted`.
   - `AMO_UPLOAD_SOURCE`: set to `true` to upload a source archive during AMO signing.
   - `AMO_METADATA`: set to `.github/amo-metadata.json` so the API-created version carries a license. AMO's version-create API rejects listed submissions with `license` missing even when a license is already selected on the add-on's Developer Hub listing page; the dashboard setting does not get applied automatically to API-created versions.

For listed publishing, AMO needs public listing metadata and review information. The first listed submission is usually easiest to do in Developer Hub so you can fill in the listing, privacy, permissions, and review fields interactively. After the listing exists, tagged releases can publish updates through the GitHub workflow.

Because this project is bundled by Vite, AMO reviewers may ask for readable source code for listed review. Build instructions for reviewers are maintained in [amo-source-build.md](amo-source-build.md). Set `AMO_UPLOAD_SOURCE=true` so the workflow uploads a repository source archive with the signed submission.

## GitHub Release Flow

Builds run automatically on pull requests and pushes to `main` or `master`.

A tag starting with `v` triggers signing:

```sh
NEW_VERSION=0.1.0
npm version "$NEW_VERSION" --no-git-tag-version
node -e "const fs=require('fs'); const path='public/manifest.json'; const manifest=require('./public/manifest.json'); manifest.version=process.env.NEW_VERSION; fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')"
git add package.json package-lock.json public/manifest.json
git commit -m "Release v$NEW_VERSION"
git tag "v$NEW_VERSION"
git push origin HEAD "v$NEW_VERSION"
```

Before pushing a release tag, make sure all three versions match:

- Git tag: `v0.1.0`
- `package.json`: `0.1.0`
- `public/manifest.json`: `0.1.0`

The signing job fails if they do not match.

The workflow:

1. Installs dependencies with `npm ci`.
2. Runs lint, tests, TypeScript build, and `web-ext lint`.
3. Packages an unsigned ZIP for CI artifacts.
4. On `v*` tags, signs through AMO with `web-ext sign`.
5. Uploads the signed package to workflow artifacts and attaches it to the matching GitHub release.

If the GitHub release does not already exist, create it first from the tag in GitHub, or create it locally:

```sh
gh release create v0.1.0 --title "v0.1.0" --notes "Initial signed build"
```

## Install From Firefox Add-ons

For a normal Firefox Add-ons page:

1. Set `AMO_CHANNEL=listed`.
2. Submit the add-on to AMO and complete the listing/review requirements.
3. Wait for AMO approval.
4. Open the published AMO page, for example:

```text
https://addons.mozilla.org/firefox/addon/<your-addon-slug>/
```

Users click `Add to Firefox` on that page. They should not install the unsigned ZIP from GitHub.

## Install an Unlisted Build

For internal use:

1. Keep `AMO_CHANNEL=unlisted`.
2. Push a `v*` tag.
3. Download the signed `.xpi` from the GitHub release or workflow artifact.
4. Open the `.xpi` in Firefox and approve the install prompt.

Unlisted builds do not have a public AMO page.
