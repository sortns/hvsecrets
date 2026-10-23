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

## Multi-Step Login (0.0.4)

- On a username-only screen (e.g. accounts.google.com) focusing the email field shows saved logins; picking one fills only the username.
- A site search box on the same page does not show the suggestion menu.
- After "Next", focusing the password field shows only the account chosen/typed on the first screen; picking it fills the password.
- Typing the username by hand and pressing Enter / "Next" gives the same result on the password screen.
- Submitting the password screen captures the login with the first screen's username (save prompt appears on the next visit if the site redirects away immediately).

## Credential Save And Update

- Submitting a new login shows the page-level save prompt.
- Saving creates one credential under the exact origin.
- Repeating login with the same username and same password does not show a save prompt.
- Repeating login with the same username and changed password updates the existing Vault entry.
- Existing credentials for `http`, `https`, and subdomains remain separate.

## Popup (0.0.4)

- Popup opens and stays open on a site with saved logins while the Vault token is valid (the 0.0.2/0.0.3 "opens and immediately closes" bug).
- Popup keeps the same size when switching tabs and when search results load.
- `Show` reveals the password inline, `Hide` clears it; `Copy` puts the password on the clipboard.
- `Delete` asks for confirmation; `Cancel`/`Escape` returns to the row; confirming removes the login from the list and from Search.
- Search loads once, then filters instantly while typing; the reload button fetches fresh data from Vault.
- With an expired token the popup shows an expired badge and "Vault session expired" instead of "no saved logins".
- Generator: changing length/character types regenerates; the last character type can't be unchecked; options persist between popup openings.
- `Fill on page` fills password + confirmation on a sign-up form, the focused field on an unhinted change-password form, and asks to focus a field when the target is ambiguous.

## Regression Checks

- Popup no longer shows manual save or captured-login controls.
- Popup still lists credentials for the current origin.
- Broad content-script access works on normal HTTP/HTTPS pages.
- Extension status messages do not show raw passwords or Vault tokens.
