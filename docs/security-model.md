# HVSecrets Security Model

## Boundaries

- Vault tokens are stored only in extension local storage and are used only by the background script.
- Content scripts never receive Vault tokens or direct Vault responses.
- Content scripts send semantic credential requests to the background script.
- Credentials are bound to exact URL origins. `https://example.com`, `http://example.com`, and `https://app.example.com` are separate origins.

## Message Validation

- Runtime messages are allowlisted by type and validated for required field types.
- Credential IDs must be UUID-shaped.
- Captured login payloads must use `http` or `https` URLs.
- Username, password, title, URL, and token fields have size limits at the message boundary.
- Content-script fill messages are validated before page fields are modified.

## Vault Path Safety

- Vault path segments allow only letters, numbers, `.`, `_`, and `-`.
- Empty segments, `.` segments, `..` segments, query strings, and other path metacharacters are rejected.
- Vault URLs must use `http` or `https`; query strings and fragments are stripped.

## Permissions

- The extension currently injects content scripts on `<all_urls>` so it can behave like a password manager without per-site prompts.
- The manifest keeps only currently used extension permissions: `storage`, `contextMenus`, and `tabs`.
- The broad host permission should be revisited before a public release if per-site enablement becomes acceptable.

## Popup Data Handling

- Search uses a background-memory index of credential summaries (origin, username, title, URL; never passwords). It is keyed by Vault URL, namespace, mount, base path and token, expires after 2 minutes, and is dropped on every save or delete.
- Passwords reach the popup only on an explicit `Copy`/`Show` click and are not persisted there.
- Delete removes the KV v2 metadata (all versions). The record is re-read first and must belong to the requested origin.
- 401/403 from Vault is surfaced as an expired session instead of an empty credential list.
- Generated passwords use `crypto.getRandomValues` with rejection sampling and a Fisher-Yates shuffle; generator options (not passwords) are stored in extension local storage.

## Multi-Step Logins

- The username typed or picked on a username-only screen is stored in `browser.storage.session` (in-memory, cleared with the browser session) keyed by tab, bound to the exact origin, expiring after 10 minutes and cleared once the password is captured. Passwords are never stored there.
- On the password screen only credentials whose username matches that value (or a hidden/read-only username field on the page) are offered, so one click cannot fill another account's password.

## Known Development Tradeoffs

- `browser.storage.local` is not an OS-backed secret store. A native helper or OS keychain integration is still recommended before wider release.
- OIDC currently follows the Vault CLI-style localhost redirect flow by watching the login tab URL and completing Vault's callback API from the background script.
- Existing duplicate credentials in Vault are not automatically merged.
