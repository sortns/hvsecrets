# Firefox Vault Security Model

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

## Known Development Tradeoffs

- `browser.storage.local` is not an OS-backed secret store. A native helper or OS keychain integration is still recommended before wider release.
- OIDC currently follows the Vault CLI-style localhost redirect flow by watching the login tab URL and completing Vault's callback API from the background script.
- Existing duplicate credentials in Vault are not automatically merged.
