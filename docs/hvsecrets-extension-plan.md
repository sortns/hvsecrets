# HVSecrets Extension Plan

## Goal

Develop a Mozilla Firefox extension that acts as a replacement workflow for the default Firefox password manager, using HashiCorp Vault KV as the backing store for saved credentials.

The extension should support configuration for:

- Vault URL
- Vault secret path for Firefox secrets
- Authentication mode:
  - Vault token
  - Vault OIDC

During development, the project should provide a local/testable version of the extension before preparing it for wider community use.

## High-Level Scope

Build a Firefox WebExtension that provides password-manager behavior backed by HashiCorp Vault KV.

The extension cannot truly replace Firefox's internal password manager APIs. Instead, it should provide its own save, lookup, autofill, and credential-management UX using extension APIs, content scripts, background logic, and Vault as the source of truth.

Firefox content scripts can read and modify page content only on origins where the extension has permission. Background scripts communicate with those content scripts through extension messaging. This is the right architecture for detecting login forms and filling credentials.

## Recommended Architecture

Use a Manifest V3 Firefox extension with the following main parts.

### Background Service Worker / Background Script

- Owns Vault API communication.
- Owns auth state.
- Handles token refresh or re-login prompts.
- Never exposes Vault tokens directly to content scripts.

### Content Script

- Detects login, registration, password-change, and OTP-like forms.
- Requests matching credentials from the background script.
- Fills fields only after explicit user action, at least for the first implementation.
- Detects successful login or submitted credentials and offers to save or update.

### Popup UI

- Shows matching credentials for the current origin.
- Allows fill, copy username, copy password, save, update, and delete.
- Shows auth and configuration state.

### Options / Settings Page

- Vault URL.
- KV mount and secret path namespace.
- Auth mode: token or OIDC.
- Optional advanced settings:
  - Auth mount path
  - OIDC role
  - TLS behavior
  - Path template
  - Permission mode

### Vault Client Module

- Small typed wrapper around the Vault HTTP API.
- Supports KV v2 first.
- Detects or explicitly configures KV v1/v2 later if needed.
- Uses `X-Vault-Token` only inside the background context.

Vault KV v2 is versioned and supports check-and-set semantics, which is useful for avoiding accidental overwrite during updates. Design for KV v2 first and treat KV v1 as a later compatibility option.

## Data Model

Suggested Vault layout:

```text
<mount>/data/<base-path>/credentials/<normalized-origin>/<credential-id>
<mount>/metadata/<base-path>/credentials/<normalized-origin>/<credential-id>
```

Example logical record:

```json
{
  "schema": 1,
  "origin": "https://example.com",
  "realm": null,
  "username": "alice@example.com",
  "password": "...",
  "url": "https://example.com/login",
  "title": "Example",
  "created_at": "2026-05-18T...",
  "updated_at": "2026-05-18T...",
  "tags": [],
  "notes": ""
}
```

Avoid one giant JSON blob for all passwords. Per-origin and per-entry records are easier to update safely, audit, delete, and eventually sync.

## Auth Design

Support two authentication modes.

### Vault Token Mode

- User pastes a Vault token.
- Extension validates the token with token lookup/self if available.
- Store the token only in extension local storage for the development version.
- Later harden with native messaging or OS keychain integration if community/public use is planned.

### Vault OIDC Mode

- Use Firefox `identity.launchWebAuthFlow()` to start an OAuth/OIDC browser flow.
- Treat Vault as the auth target, not the upstream identity provider directly.
- Vault's JWT/OIDC auth method should complete the OIDC flow and return a Vault client token.

Required settings likely include:

- Vault URL
- OIDC auth mount, defaulting to `oidc` or `jwt`
- Vault role
- Redirect URI strategy
- Optional Vault Enterprise namespace

Open question: Vault OIDC browser flow may be awkward inside an extension depending on redirect URI constraints and Vault role config. Prototype this early before building too much UI around it.

## Security Design

### Vault Token Isolation

Vault tokens must never be sent to content scripts.

Content scripts should send semantic requests only:

- `findCredentialsForOrigin`
- `fillSelectedCredential`
- `saveCredential`

The background script performs all Vault calls.

### Strict Origin Binding

- A credential saved for `https://example.com` must not fill into `http://example.com`.
- A credential saved for `example.com` must not automatically fill into subdomains unless explicitly allowed.
- A credential must not fill into iframes or lookalike domains unless explicitly allowed.
- Normalize using the URL API, not string slicing.

### Minimal Permissions

Start with:

- `activeTab`
- `storage`
- `scripting`
- Optional host permissions

Avoid `<all_urls>` by default if possible.

Use optional permissions so users can grant site access only where they want autofill.

### No Automatic Password Fill In Version 1

The first version should show a popup or inline chooser. Auto-fill can come later behind an explicit setting.

### No Secrets In Logs

Redact:

- Passwords
- Tokens
- Vault responses
- Auth headers

Add a safe debug logger from day one.

### Clipboard Safety

- Copy password only after user action.
- Clear clipboard after a configurable timeout if feasible.
- Show clear feedback when copying.

### CSP And Dependency Discipline

- No remote scripts.
- Bundle dependencies.
- No `eval`.
- Keep content scripts small.

### Narrow Vault Policy

The token or OIDC role should only access the configured secret path.

Example policy:

```hcl
path "secret/data/hvsecrets/*" {
  capabilities = ["create", "read", "update", "delete"]
}

path "secret/metadata/hvsecrets/*" {
  capabilities = ["list", "read", "delete"]
}
```

### Local Token Storage Risk

`browser.storage.local` is persistent extension storage and better suited than page `localStorage` for extension data, but it is not a hardware-backed secret store.

For a public-grade version, consider a native companion that stores tokens in the OS keychain. Firefox native messaging is designed for extensions to communicate with native apps, including password-manager-style use cases.

## Development Plan

### Phase 0: Repository Bootstrap

- Create extension project structure.
- Use TypeScript.
- Use `web-ext` for local Firefox loading.
- Add linting, formatting, and unit test runner.
- Add `.env.example` for local Vault development values.
- Never commit real secrets.

### Phase 1: Local Vault Client

- Implement KV v2 read, write, list, and delete.
- Implement token auth.
- Add integration test against local Vault dev server.
- Define credential schema and migration versioning.

### Phase 2: Extension Skeleton

- Add manifest.
- Add background script.
- Add popup.
- Add options page.
- Add storage module for non-secret config.

### Phase 3: Token-Auth MVP

- Configure Vault URL, path, and token.
- Validate config.
- Save credential manually from popup.
- Retrieve credential by current tab origin.
- Fill selected credential into page.

### Phase 4: Form Detection And Save/Update Flow

- Detect login forms.
- Detect submit.
- Offer save/update after login attempt.
- Add denylist and per-site settings.

### Phase 5: OIDC Prototype

- Test Firefox identity redirect behavior with Vault OIDC.
- Implement login flow if viable.
- Store resulting Vault client token with expiry metadata.
- Handle expiration and re-auth.

### Phase 6: Hardening

- Threat model review.
- Permission minimization.
- Redacted logging.
- Input validation.
- Path traversal prevention for Vault paths.
- Origin matching tests.
- Content-script message validation.

### Phase 7: Local Release Package

- Build unsigned local extension.
- Document local Firefox install/test flow.
- Add demo Vault setup script and policy.
- Add manual test checklist.

### Phase 8: Community Readiness

- Add README.
- Add security model.
- Add documented limitations.
- Add contribution guide.
- Add issue templates.

## Key Questions

1. Should the first version support only KV v2, or is KV v1 compatibility required?

- kv2 support

2. Is this for a single user/team, or should it be designed as a community extension from the start?

- it is a single person, but after 1st successfull release we will publish the repo

3. Should the extension request access to all sites, or require users to enable autofill per site?

- We should not anooying user each time asking the permissions.SO if need any site so let it be.

4. For OIDC, is Vault already configured with an OIDC role?

- yes

5. If Vault OIDC is already configured, what is the auth mount path and expected redirect URI?

- it should be configurable, as each vault might have its own path

6. Should secrets be stored as plaintext in Vault KV, or should the extension use client-side encryption before writing to Vault?

- plaint text in vault

7. Is import from Firefox's existing saved passwords required, or only new saves going forward?

- Yes, it will be great to have it.

8. Is a native companion app for OS keychain token storage required, or is extension-local token storage acceptable for the development version?

- For the develop we might use some token, but in long term we might use OS keychain
