# HVSecrets

HVSecrets is a development-stage browser extension that provides a password-manager workflow backed by HashiCorp Vault KV v2.

Instead, it uses content scripts, a background script, popup/options pages, and Vault API calls to detect login forms, offer fills, and save/update credentials in Vault.

## Current Features

- Vault KV v2 credential storage.
- Token authentication with connection/token validation.
- Vault OIDC login using the Vault CLI-style callback flow: `http://localhost:8250/oidc/callback`.
- Exact-origin credential binding.
- Inline credential suggestions on username/password fields.
- Context-menu credential fill.
- Page-level save/update prompt after login attempts.
- Duplicate prevention by `origin + username`.
- Same username with changed password updates the existing Vault entry.
- Ignored origins for save prompts, manageable from Options.
- Light/dark theme support for popup, options, and injected prompts.

## Requirements

- Node.js 20 or newer.
- Firefox.
- HashiCorp Vault with a KV v2 mount.
- A Vault token or Vault OIDC role that can access the configured path.

## Install Dependencies

```sh
npm install
```

## Development

Run checks:

```sh
npm run lint
npm run test
npm run build
npm run web-ext:lint
```

Run in Firefox:

```sh
npm run web-ext:run
```

Run in Windows Firefox from WSL:

```sh
npm run web-ext:run:windows
```

Manual temporary install:

1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on...`.
4. Select `dist/manifest.json`.

Reload the temporary add-on after manifest permission changes.

## Local Release Package

Build, validate, and package an unsigned local extension:

```sh
npm run release:local
```

The unsigned package is written to `web-ext-artifacts/` and is intentionally ignored by git.

More detail: [docs/local-release.md](docs/local-release.md)

## GitHub Publishing

GitHub Actions builds, tests, validates, and packages the extension on pull requests and pushes to `main` or `master`.

Tag releases like `v0.1.0` can also be signed through Mozilla Add-ons when the repository has AMO API secrets configured:

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

Use the optional repository variable `AMO_CHANNEL` to choose `unlisted` or `listed`. The default is `unlisted`.

For a public Firefox Add-ons page, publish as `listed` and complete AMO review. For internal/self-distributed builds, publish as `unlisted` and install the signed `.xpi` from a GitHub release.

More detail: [docs/amo-publishing.md](docs/amo-publishing.md)

AMO source build instructions: [docs/amo-source-build.md](docs/amo-source-build.md)

## Vault Setup

Example policy:

```hcl
path "firefox/data/hvsecrets/*" {
  capabilities = ["create", "read", "update", "delete"]
}

path "firefox/metadata/hvsecrets/*" {
  capabilities = ["list", "read", "delete"]
}
```

For a local/dev Vault where the current `VAULT_TOKEN` can manage mounts and policies:

```sh
export VAULT_ADDR='http://127.0.0.1:8200'
export VAULT_TOKEN='...'
VAULT_KV_MOUNT='firefox' VAULT_BASE_PATH='hvsecrets' ./scripts/setup-demo-vault.sh
```

The extension Options page needs:

- Vault URL.
- KV mount.
- Base secret path.
- Optional Vault namespace.
- Auth mode: Token or OIDC.

Token mode stores the Vault token in extension local storage for development use.

OIDC mode opens the provider login in a tab, watches for the Vault CLI-style localhost callback, then completes Vault's OIDC callback API from the background script.

## Credential Layout

Credentials are stored per exact origin:

```text
<mount>/data/<base-path>/credentials/<normalized-origin>/<credential-id>
<mount>/metadata/<base-path>/credentials/<normalized-origin>/<credential-id>
```

Examples of separate origins:

- `https://example.com`
- `http://example.com`
- `https://app.example.com`

Existing duplicate entries are not automatically merged. New saves update by `origin + username`.

## User Workflow

- Focus a login field to see saved users for that origin.
- Pick a saved user to fill username and password.
- Submit a new or changed login to get a page-level save/update prompt.
- Use `Ignore this origin` on that prompt to stop future save prompts for the site.
- Manage ignored origins from the Options page.

## Security Notes

- Vault tokens are never sent to content scripts.
- Content scripts send semantic requests to the background script.
- Runtime messages and content fill messages are validated.
- Vault paths reject traversal and unsafe segments.
- Vault URLs must use `http` or `https`.
- `browser.storage.local` is not OS-keychain-backed storage.
- The extension currently uses `<all_urls>` host access to behave like a password manager without per-site prompts.

More detail: [docs/security-model.md](docs/security-model.md)

## Testing

Unit tests:

```sh
npm run test
```

Vault integration test:

```sh
export VAULT_ADDR='http://127.0.0.1:8200'
export VAULT_TOKEN='...'
VAULT_INTEGRATION_TEST=1 npm run test:integration
```

Manual test checklist: [docs/manual-test-checklist.md](docs/manual-test-checklist.md)

## Status

This is still a local/development build. Before wider release, the project still needs community-facing docs, documented limitations, contribution workflow, and a decision on OS keychain/native helper support.
