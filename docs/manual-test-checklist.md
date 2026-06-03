# Manual Test Checklist

Use this checklist before sharing a local build.

## Build

- `npm run release:local` completes successfully.
- `web-ext-artifacts/` contains a fresh unsigned package.
- `about:debugging` can load `dist/manifest.json`.

## Configuration

- Options page loads in light and dark system themes.
- Token auth saves config without displaying the token after reload.
- `Check Connection` reports success with a valid token.
- `Check Connection` reports a clear error with an invalid or missing token.
- OIDC login opens a browser tab, completes login, closes the callback tab, and stores a Vault token.

## Credential Fill

- Login page username field shows saved credential suggestions.
- Password field shows suggestions beside the input when there is horizontal room.
- Suggestion menu does not cover the active input in the normal login form layout.
- Clicking a suggestion fills username and password.
- Context menu shows saved users for the current origin and fills the selected credential.

## Credential Save And Update

- Submitting a new login shows the page-level save prompt.
- Saving creates one credential under the exact origin.
- Repeating login with the same username and same password does not show a save prompt.
- Repeating login with the same username and changed password updates the existing Vault entry.
- Existing credentials for `http`, `https`, and subdomains remain separate.

## Regression Checks

- Popup no longer shows manual save or captured-login controls.
- Popup still lists credentials for the current origin.
- Broad content-script access works on normal HTTP/HTTPS pages.
- Extension status messages do not show raw passwords or Vault tokens.
