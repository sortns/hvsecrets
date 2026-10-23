import "./styles.css";
import type { ExtensionConfig } from "../shared/config";
import type { RuntimeRequest, RuntimeResponse } from "../shared/messages";
import {
  clampLength,
  defaultPasswordGeneratorOptions,
  generatePassword,
  passwordEntropyBits,
  type PasswordGeneratorOptions,
} from "../shared/password-generator";
import type { CredentialSummary } from "../vault/credential-repository";
import { setIcon } from "./icons";

type TabName = "site" | "search" | "generator";
type StatusTone = "info" | "success" | "error";

const generatorOptionsStorageKey = "passwordGeneratorOptions";
// Rendering thousands of rows makes the popup sluggish; past this the
// user should narrow the filter anyway.
const maxRenderedSearchResults = 200;

const authBadge = getElement("auth-badge");
const vaultTargetElement = getElement("vault-target");
const siteOriginElement = getElement("site-origin");
const credentialListElement = getElement("credential-list");
const statusElement = getElement("status");
const validateButton = getButton("validate-token");
const oidcLoginButton = getButton("login-oidc");
const approleLoginButton = getButton("login-approle");
const refreshButton = getButton("refresh");
const openOptionsButton = getButton("open-options");
const searchQueryInput = getElement("search-query") as HTMLInputElement;
const searchRefreshButton = getButton("search-refresh");
const searchSummaryElement = getElement("search-summary");
const searchResultsElement = getElement("search-results");
const generatedPasswordInput = getElement(
  "generated-password",
) as HTMLInputElement;
const regenerateButton = getButton("regenerate");
const strengthFill = getElement("strength-fill");
const strengthLabel = getElement("strength-label");
const lengthRange = getElement("length-range") as HTMLInputElement;
const lengthNumber = getElement("length-number") as HTMLInputElement;
const copyGeneratedButton = getButton("copy-generated");
const fillGeneratedButton = getButton("fill-generated");
const optionInputs = {
  lowercase: getElement("opt-lowercase") as HTMLInputElement,
  uppercase: getElement("opt-uppercase") as HTMLInputElement,
  digits: getElement("opt-digits") as HTMLInputElement,
  symbols: getElement("opt-symbols") as HTMLInputElement,
  excludeAmbiguous: getElement("opt-ambiguous") as HTMLInputElement,
} as const;

const tabs: Record<TabName, { tab: HTMLButtonElement; panel: HTMLElement }> = {
  site: { tab: getButton("tab-site"), panel: getElement("panel-site") },
  search: { tab: getButton("tab-search"), panel: getElement("panel-search") },
  generator: {
    tab: getButton("tab-generator"),
    panel: getElement("panel-generator"),
  },
};

let currentOrigin: string | null = null;
let searchIndex: CredentialSummary[] | null = null;
let searchLoading = false;
let generatorOptions: PasswordGeneratorOptions =
  defaultPasswordGeneratorOptions;
let generatorReady = false;

setIcon(openOptionsButton, "settings");
setIcon(refreshButton, "refresh");
setIcon(searchRefreshButton, "refresh");
setIcon(regenerateButton, "refresh");

for (const [name, { tab }] of Object.entries(tabs) as [
  TabName,
  (typeof tabs)[TabName],
][]) {
  tab.addEventListener("click", () => {
    selectTab(name);
  });
  tab.addEventListener("keydown", (event) => {
    moveTabFocus(name, event);
  });
}

validateButton.addEventListener("click", () => {
  void checkConnection(true);
});
oidcLoginButton.addEventListener("click", () => {
  void login("auth.loginOidc", "OIDC");
});
approleLoginButton.addEventListener("click", () => {
  void login("auth.loginApprole", "AppRole");
});
refreshButton.addEventListener("click", () => {
  void loadCredentials();
});
openOptionsButton.addEventListener("click", () => {
  void browser.runtime.openOptionsPage();
});
searchQueryInput.addEventListener("input", () => {
  renderSearchResults();
});
searchRefreshButton.addEventListener("click", () => {
  void loadSearchIndex(true);
});
regenerateButton.addEventListener("click", () => {
  regeneratePassword();
});
lengthRange.addEventListener("input", () => {
  updateGeneratorOptions({ length: Number(lengthRange.value) });
});
lengthNumber.addEventListener("change", () => {
  updateGeneratorOptions({ length: Number(lengthNumber.value) });
});
for (const [name, input] of Object.entries(optionInputs) as [
  keyof typeof optionInputs,
  HTMLInputElement,
][]) {
  input.addEventListener("change", () => {
    const next = { ...generatorOptions, [name]: input.checked };

    if (passwordEntropyBits(next) === 0) {
      input.checked = true;
      setStatus("Keep at least one character type", "error");
      return;
    }

    updateGeneratorOptions({ [name]: input.checked });
  });
}
copyGeneratedButton.addEventListener("click", () => {
  void copyToClipboard(generatedPasswordInput.value, "Password copied");
});
fillGeneratedButton.addEventListener("click", () => {
  void fillGeneratedPassword();
});

void loadState();

async function loadState(): Promise<void> {
  const response = await sendRuntimeRequest({ type: "config.get" });

  if (response.type !== "config.state") {
    setStatus("Unable to load configuration", "error");
    return;
  }

  const { config, validation } = response;
  vaultTargetElement.textContent = `${hostOf(config.vaultUrl)} · ${config.kvMount}/${config.basePath}`;
  oidcLoginButton.hidden = config.authMode !== "oidc";
  approleLoginButton.hidden = config.authMode !== "approle";
  renderAuthBadge(config, validation.ok);

  if (!validation.ok) {
    setStatus(validation.errors.join(". "), "error");
    renderEmpty(credentialListElement, "Finish setup in Options to continue.");
    return;
  }

  await loadCredentials();
  void checkConnection(false);
}

async function loadCredentials(): Promise<void> {
  refreshButton.disabled = true;
  const response = await sendRuntimeRequest({
    type: "credentials.listForCurrentTab",
  });
  refreshButton.disabled = false;

  if (response.type !== "credentials.list") {
    setStatus("Unable to load credentials", "error");
    return;
  }

  currentOrigin = response.origin;
  siteOriginElement.textContent = response.origin ?? "No website in this tab";

  if (response.error !== undefined) {
    renderEmpty(
      credentialListElement,
      response.origin === null
        ? "Open a website to see its saved logins."
        : "Couldn't load saved logins from Vault.",
    );
    setStatus(response.error, response.origin === null ? "info" : "error");
    return;
  }

  renderCredentials(response.credentials);

  setStatus(countLabel(response.credentials.length, "saved login"));
}

function renderCredentials(credentials: readonly CredentialSummary[]): void {
  if (credentials.length === 0) {
    renderEmpty(
      credentialListElement,
      currentOrigin === null
        ? "Open a website to see its saved logins."
        : "No saved logins for this site yet. Sign in and HVSecrets will offer to save it.",
    );
    return;
  }

  credentialListElement.replaceChildren(
    ...credentials.map((credential) =>
      createCredentialItem(credential, {
        showOrigin: false,
        canFill: true,
      }),
    ),
  );
}

async function loadSearchIndex(refresh: boolean): Promise<void> {
  if (searchLoading) {
    return;
  }

  searchLoading = true;
  searchRefreshButton.disabled = true;
  searchSummaryElement.textContent = "Loading secrets from Vault…";

  if (searchIndex === null) {
    renderEmpty(searchResultsElement, "Loading…");
  }

  const response = await sendRuntimeRequest({
    type: "credentials.search",
    query: "",
    refresh,
  });
  searchLoading = false;
  searchRefreshButton.disabled = false;

  if (response.type !== "credentials.searchResult") {
    setStatus("Unable to search credentials", "error");
    return;
  }

  if (response.error !== undefined) {
    searchSummaryElement.textContent = "";
    renderEmpty(searchResultsElement, "Search is unavailable right now.");
    setStatus(response.error, "error");
    return;
  }

  searchIndex = [...response.credentials].sort(compareCredentials);
  renderSearchResults();
}

// Filtering happens locally on the index the background already loaded,
// so typing never waits on Vault.
function renderSearchResults(): void {
  if (searchIndex === null) {
    return;
  }

  const query = searchQueryInput.value.trim().toLowerCase();
  const matches =
    query.length === 0
      ? searchIndex
      : searchIndex.filter((credential) =>
          [
            credential.origin,
            credential.url,
            credential.title,
            credential.username,
          ].some((value) => value.toLowerCase().includes(query)),
        );

  searchSummaryElement.textContent =
    query.length === 0
      ? countLabel(searchIndex.length, "secret")
      : `${String(matches.length)} of ${countLabel(searchIndex.length, "secret")}`;

  if (matches.length === 0) {
    renderEmpty(
      searchResultsElement,
      searchIndex.length === 0
        ? "Nothing saved in Vault yet."
        : "No secrets match this filter.",
    );
    return;
  }

  const visible = matches.slice(0, maxRenderedSearchResults);
  const items = visible.map((credential) =>
    createCredentialItem(credential, {
      showOrigin: true,
      canFill: credential.origin === currentOrigin,
    }),
  );

  if (matches.length > visible.length) {
    const more = document.createElement("li");
    more.className = "empty-state";
    more.textContent = `Showing first ${String(visible.length)}. Type to narrow down.`;
    items.push(more);
  }

  searchResultsElement.replaceChildren(...items);
}

function createCredentialItem(
  credential: CredentialSummary,
  options: { readonly showOrigin: boolean; readonly canFill: boolean },
): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "credential";

  const info = document.createElement("div");
  info.className = "credential-info";
  const username = document.createElement("span");
  username.className = "credential-user";

  if (credential.username.length === 0) {
    username.classList.add("empty");
    username.textContent = "No username";
  } else {
    username.textContent = credential.username;
  }

  const meta = document.createElement("span");
  meta.className = "credential-meta";
  meta.textContent = options.showOrigin
    ? displayOrigin(credential.origin)
    : credential.title;
  meta.hidden = meta.textContent.length === 0;
  info.append(username, meta);

  const actions = document.createElement("div");
  actions.className = "credential-actions";

  const secret = document.createElement("code");
  secret.className = "credential-secret mono";
  secret.hidden = true;

  let cachedPassword: string | null = null;
  const getPassword = async (): Promise<string | null> => {
    if (cachedPassword !== null) {
      return cachedPassword;
    }

    const response = await sendRuntimeRequest({
      type: "credentials.reveal",
      origin: credential.origin,
      credentialId: credential.id,
    });

    if (response.type !== "credentials.revealResult" || !response.ok) {
      setStatus(
        response.type === "credentials.revealResult" &&
          response.error !== undefined
          ? response.error
          : "Unable to read password",
        "error",
      );
      return null;
    }

    cachedPassword = response.password ?? "";
    return cachedPassword;
  };

  if (options.canFill) {
    const fillButton = document.createElement("button");
    fillButton.type = "button";
    fillButton.className = "primary fill";
    fillButton.textContent = "Fill";
    fillButton.addEventListener("click", () => {
      void fillCredential(credential.id);
    });
    actions.append(fillButton);
  }

  const copyButton = iconButton("copy", "Copy password");
  copyButton.addEventListener("click", () => {
    void (async () => {
      copyButton.disabled = true;
      const password = await getPassword();
      copyButton.disabled = false;

      if (password !== null) {
        await copyToClipboard(password, "Password copied");
      }
    })();
  });

  const revealButton = iconButton("eye", "Show password");
  revealButton.addEventListener("click", () => {
    void (async () => {
      if (!secret.hidden) {
        secret.hidden = true;
        secret.textContent = "";
        setIconButton(revealButton, "eye", "Show password");
        return;
      }

      revealButton.disabled = true;
      const password = await getPassword();
      revealButton.disabled = false;

      if (password === null) {
        return;
      }

      secret.textContent = password;
      secret.hidden = false;
      setIconButton(revealButton, "eyeOff", "Hide password");
    })();
  });

  const deleteButton = iconButton("trash", "Delete login");
  deleteButton.classList.add("danger-icon");

  const confirm = document.createElement("div");
  confirm.className = "credential-confirm";
  confirm.hidden = true;
  const confirmText = document.createElement("span");
  confirmText.textContent = "Delete permanently from Vault?";
  const confirmDelete = document.createElement("button");
  confirmDelete.type = "button";
  confirmDelete.className = "danger";
  confirmDelete.textContent = "Delete";
  const cancelDelete = document.createElement("button");
  cancelDelete.type = "button";
  cancelDelete.textContent = "Cancel";
  confirm.append(confirmText, confirmDelete, cancelDelete);

  const setConfirming = (confirming: boolean): void => {
    confirm.hidden = !confirming;
    actions.hidden = confirming;
    (confirming ? cancelDelete : deleteButton).focus();
  };

  deleteButton.addEventListener("click", () => {
    setConfirming(true);
  });
  cancelDelete.addEventListener("click", () => {
    setConfirming(false);
  });
  confirm.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setConfirming(false);
    }
  });
  confirmDelete.addEventListener("click", () => {
    void (async () => {
      confirmDelete.disabled = true;
      cancelDelete.disabled = true;
      const deleted = await deleteCredential(credential);
      confirmDelete.disabled = false;
      cancelDelete.disabled = false;

      if (!deleted) {
        setConfirming(false);
      }
    })();
  });

  actions.append(copyButton, revealButton, deleteButton);
  item.append(info, actions, secret, confirm);

  return item;
}

async function deleteCredential(
  credential: CredentialSummary,
): Promise<boolean> {
  setStatus("Deleting…");
  const response = await sendRuntimeRequest({
    type: "credentials.delete",
    origin: credential.origin,
    credentialId: credential.id,
  });

  if (response.type !== "credentials.deleteResult" || !response.ok) {
    setStatus(
      response.type === "credentials.deleteResult" &&
        response.error !== undefined
        ? response.error
        : "Unable to delete login",
      "error",
    );
    return false;
  }

  const label =
    credential.username.length === 0 ? "Login" : `“${credential.username}”`;
  setStatus(
    `${label} deleted from ${displayOrigin(credential.origin)}`,
    "success",
  );

  if (searchIndex !== null) {
    searchIndex = searchIndex.filter((entry) => entry.id !== credential.id);
    renderSearchResults();
  }

  if (credential.origin === currentOrigin) {
    await loadCredentials();
    setStatus(
      `${label} deleted from ${displayOrigin(credential.origin)}`,
      "success",
    );
  }

  return true;
}

async function fillCredential(credentialId: string): Promise<void> {
  setStatus("Filling…");
  const response = await sendRuntimeRequest({
    type: "credentials.fillCurrentTab",
    credentialId,
  });

  if (response.type !== "credentials.fillResult" || !response.ok) {
    setStatus(
      response.type === "credentials.fillResult" && response.error !== undefined
        ? response.error
        : "Unable to fill credential",
      "error",
    );
    return;
  }

  setStatus("Login filled", "success");
}

async function initGenerator(): Promise<void> {
  if (generatorReady) {
    return;
  }

  generatorReady = true;

  try {
    const stored = await browser.storage.local.get(generatorOptionsStorageKey);
    generatorOptions = parseGeneratorOptions(
      stored[generatorOptionsStorageKey],
    );
  } catch {
    generatorOptions = defaultPasswordGeneratorOptions;
  }

  syncGeneratorControls();
  regeneratePassword();
}

function updateGeneratorOptions(
  patch: Partial<PasswordGeneratorOptions>,
): void {
  generatorOptions = {
    ...generatorOptions,
    ...patch,
    length: clampLength(patch.length ?? generatorOptions.length),
  };
  syncGeneratorControls();
  regeneratePassword();
  void browser.storage.local
    .set({ [generatorOptionsStorageKey]: generatorOptions })
    .catch(() => undefined);
}

function syncGeneratorControls(): void {
  lengthRange.value = String(generatorOptions.length);
  lengthNumber.value = String(generatorOptions.length);

  for (const [name, input] of Object.entries(optionInputs) as [
    keyof typeof optionInputs,
    HTMLInputElement,
  ][]) {
    input.checked = generatorOptions[name];
  }
}

function regeneratePassword(): void {
  generatedPasswordInput.value = generatePassword(generatorOptions);

  const bits = passwordEntropyBits(generatorOptions);
  const level = bits < 60 ? "weak" : bits < 90 ? "fair" : "strong";
  const label =
    level === "weak" ? "Weak" : level === "fair" ? "Fair" : "Strong";
  strengthFill.dataset.level = level;
  strengthFill.style.width = `${String(Math.min(100, Math.round((bits / 128) * 100)))}%`;
  strengthLabel.textContent = `${label} · ${String(bits)} bits`;
}

async function fillGeneratedPassword(): Promise<void> {
  const response = await sendRuntimeRequest({
    type: "credentials.fillGeneratedPassword",
    password: generatedPasswordInput.value,
  });

  if (response.type !== "credentials.fillResult" || !response.ok) {
    setStatus(
      response.type === "credentials.fillResult" && response.error !== undefined
        ? response.error
        : "Unable to fill password",
      "error",
    );
    return;
  }

  setStatus("Password filled. Submit the form to save it.", "success");
}

async function checkConnection(explicit: boolean): Promise<void> {
  if (explicit) {
    setStatus("Checking Vault connection…");
  }

  const response = await sendRuntimeRequest({ type: "auth.validateToken" });

  if (response.type !== "auth.validationResult") {
    setStatus("Unable to check Vault connection", "error");
    return;
  }

  if (!response.ok) {
    // Keep a more specific "expired" badge if the token is known to be stale.
    if (authBadge.dataset.tone !== "danger") {
      authBadge.textContent = "Not connected";
      authBadge.dataset.tone = "danger";
    }

    oidcLoginButton.classList.add("primary");
    approleLoginButton.classList.add("primary");
    setStatus(
      response.error ?? "Vault connection or token validation failed",
      "error",
    );
    return;
  }

  if (explicit) {
    setStatus("Vault is reachable and the token is valid", "success");
  }
}

async function login(
  type: "auth.loginOidc" | "auth.loginApprole",
  label: string,
): Promise<void> {
  setStatus(`Starting ${label} login…`);
  const response = await sendRuntimeRequest({ type });

  if (
    response.type !== "auth.oidcLoginResult" &&
    response.type !== "auth.approleLoginResult"
  ) {
    setStatus(`Unable to start ${label} login`, "error");
    return;
  }

  searchIndex = null;
  await loadState();
  setStatus(
    response.ok
      ? `${label} login succeeded`
      : (response.error ?? `${label} login failed`),
    response.ok ? "success" : "error",
  );
}

function selectTab(name: TabName): void {
  for (const [tabName, { tab, panel }] of Object.entries(tabs) as [
    TabName,
    (typeof tabs)[TabName],
  ][]) {
    const selected = tabName === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected;
  }

  if (name === "search") {
    searchQueryInput.focus();

    if (searchIndex === null) {
      void loadSearchIndex(false);
    }
  }

  if (name === "generator") {
    void initGenerator();
  }
}

function moveTabFocus(current: TabName, event: KeyboardEvent): void {
  const order: TabName[] = ["site", "search", "generator"];
  const index = order.indexOf(current);
  const offset =
    event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;

  if (offset === 0) {
    return;
  }

  event.preventDefault();
  const next = order[(index + offset + order.length) % order.length];
  selectTab(next);
  tabs[next].tab.focus();
}

function renderAuthBadge(config: ExtensionConfig, configured: boolean): void {
  const { text, tone } = authBadgeState(config, configured);
  authBadge.textContent = text;
  authBadge.dataset.tone = tone;

  const needsLogin = tone === "danger" || tone === "warning";
  oidcLoginButton.classList.toggle("primary", needsLogin);
  approleLoginButton.classList.toggle("primary", needsLogin);
}

function authBadgeState(
  config: ExtensionConfig,
  configured: boolean,
): { readonly text: string; readonly tone: "ok" | "warning" | "danger" } {
  if (!configured) {
    return { text: "Not configured", tone: "warning" };
  }

  if (config.authMode === "token") {
    return { text: "Token", tone: "ok" };
  }

  const label = config.authMode === "approle" ? "AppRole" : "OIDC";

  if (!config.hasToken) {
    return { text: `${label} · login required`, tone: "warning" };
  }

  if (config.tokenExpiresAt === null) {
    return { text: label, tone: "ok" };
  }

  const expiresAt = Date.parse(config.tokenExpiresAt);

  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    return { text: `${label} · expired`, tone: "danger" };
  }

  return {
    text: `${label} · until ${new Date(expiresAt).toLocaleString(undefined, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })}`,
    tone: "ok",
  };
}

function parseGeneratorOptions(value: unknown): PasswordGeneratorOptions {
  if (typeof value !== "object" || value === null) {
    return defaultPasswordGeneratorOptions;
  }

  const record = value as Record<string, unknown>;
  const flag = (key: keyof PasswordGeneratorOptions): boolean =>
    typeof record[key] === "boolean"
      ? record[key]
      : (defaultPasswordGeneratorOptions[key] as boolean);
  const options: PasswordGeneratorOptions = {
    length: clampLength(
      typeof record.length === "number"
        ? record.length
        : defaultPasswordGeneratorOptions.length,
    ),
    lowercase: flag("lowercase"),
    uppercase: flag("uppercase"),
    digits: flag("digits"),
    symbols: flag("symbols"),
    excludeAmbiguous: flag("excludeAmbiguous"),
  };

  return passwordEntropyBits(options) === 0
    ? defaultPasswordGeneratorOptions
    : options;
}

async function copyToClipboard(text: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(message, "success");
  } catch {
    setStatus("Clipboard is not available here", "error");
  }
}

function iconButton(
  icon: "copy" | "eye" | "trash",
  label: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "icon-button";
  setIconButton(button, icon, label);

  return button;
}

function setIconButton(
  button: HTMLButtonElement,
  icon: "copy" | "eye" | "eyeOff" | "trash",
  label: string,
): void {
  setIcon(button, icon);
  button.setAttribute("aria-label", label);
  button.dataset.tip = label;
}

function renderEmpty(list: HTMLElement, message: string): void {
  const item = document.createElement("li");
  item.className = "empty-state";
  item.textContent = message;
  list.replaceChildren(item);
}

function compareCredentials(
  a: CredentialSummary,
  b: CredentialSummary,
): number {
  return (
    displayOrigin(a.origin).localeCompare(displayOrigin(b.origin)) ||
    a.username.localeCompare(b.username)
  );
}

function displayOrigin(origin: string): string {
  return origin.startsWith("https://") ? origin.slice(8) : origin;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function countLabel(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

async function sendRuntimeRequest(
  request: RuntimeRequest,
): Promise<RuntimeResponse> {
  return browser.runtime.sendMessage(request) as Promise<RuntimeResponse>;
}

function setStatus(message: string, tone: StatusTone = "info"): void {
  statusElement.textContent = message;
  statusElement.dataset.tone = tone;
}

function getButton(id: string): HTMLButtonElement {
  return getElement(id) as HTMLButtonElement;
}

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);

  if (element === null) {
    throw new Error(`Missing element: ${id}`);
  }

  return element;
}
