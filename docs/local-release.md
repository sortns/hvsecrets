# Local Release

This project currently produces an unsigned local Firefox extension package for development use.

## Build And Validate

Run the full local release command:

```sh
npm run release:local
```

This runs:

- TypeScript, Vite build, and WebExtension lint.
- Unsigned WebExtension packaging into `web-ext-artifacts/`.

The package is intentionally ignored by git. Rebuild it locally whenever needed.

## Run Temporarily In Firefox

Linux Firefox on `PATH`:

```sh
npm run web-ext:run
```

Windows Firefox from WSL:

```sh
npm run web-ext:run:windows
```

Manual install:

1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on...`.
4. Select `dist/manifest.json`.

Reload the temporary add-on after manifest permission changes.

## Demo Vault Setup

For a local/dev Vault where the current `VAULT_TOKEN` can manage mounts and policies:

```sh
export VAULT_ADDR='http://127.0.0.1:8200'
export VAULT_TOKEN='...'
VAULT_KV_MOUNT='firefox' VAULT_BASE_PATH='hvsecrets' ./scripts/setup-demo-vault.sh
```

The script enables a KV v2 mount if needed and writes a narrow policy for the configured base path.

Example policy only:

```sh
cat docs/vault-policy.example.hcl
```

## Extension Configuration

Token mode:

- Vault URL: `VAULT_ADDR`
- KV mount: `VAULT_KV_MOUNT`
- Base secret path: `VAULT_BASE_PATH`
- Authentication: `Token`
- Vault token: a token with the generated policy

OIDC mode:

- Vault URL: `VAULT_ADDR`
- KV mount/base path as above
- Authentication: `OIDC`
- OIDC auth mount and role from your Vault setup
- The extension follows the Vault CLI-style callback URI: `http://localhost:8250/oidc/callback`
