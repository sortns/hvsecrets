import "./styles.css";
import type { ExtensionConfig } from "../shared/config";
import type { RuntimeRequest, RuntimeResponse } from "../shared/messages";
import type { CredentialSummary } from "../vault/credential-repository";

const vaultUrlElement = getElement("vault-url");
const vaultPathElement = getElement("vault-path");
const authStateElement = getElement("auth-state");
const credentialListElement = getElement("credential-list");
const statusElement = getElement("status") as HTMLParagraphElement;
const validateButton = getElement("validate-token") as HTMLButtonElement;
const oidcLoginButton = getElement("login-oidc") as HTMLButtonElement;
const approleLoginButton = getElement("login-approle") as HTMLButtonElement;
const refreshButton = getElement("refresh") as HTMLButtonElement;
const openOptionsButton = getElement("open-options") as HTMLButtonElement;
const searchSecretsButton = getElement("search-secrets") as HTMLButtonElement;
const searchSection = getElement("search-section");
const searchForm = getElement("search-form") as HTMLFormElement;
const searchQueryInput = getElement("search-query") as HTMLInputElement;
const searchResultsElement = getElement("search-results");

void loadState();

validateButton.addEventListener("click", () => {
  void validateToken();
});
oidcLoginButton.addEventListener("click", () => {
  void loginWithOidc();
});
approleLoginButton.addEventListener("click", () => {
  void loginWithApprole();
});
refreshButton.addEventListener("click", () => {
  void refreshCredentialState();
});
openOptionsButton.addEventListener("click", () => {
  void browser.runtime.openOptionsPage();
});
searchSecretsButton.addEventListener("click", () => {
  searchSection.hidden = !searchSection.hidden;

  if (!searchSection.hidden) {
    void runSearch(searchQueryInput.value);
  }
});
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void runSearch(searchQueryInput.value);
});

async function loadState(): Promise<void> {
  const response = await sendRuntimeRequest({ type: "config.get" });

  if (response.type !== "config.state") {
    setStatus("Unable to load configuration");
    return;
  }

  vaultUrlElement.textContent = response.config.vaultUrl;
  vaultPathElement.textContent = `${response.config.kvMount}/${response.config.basePath}`;
  authStateElement.textContent = authStateText(response.config);
  oidcLoginButton.hidden = response.config.authMode !== "oidc";
  approleLoginButton.hidden = response.config.authMode !== "approle";
  setStatus(
    response.validation.ok ? "Ready" : response.validation.errors.join(". "),
  );

  if (response.validation.ok) {
    void checkConnection();
    await refreshCredentialState();
  }
}

async function refreshCredentialState(): Promise<void> {
  await loadCredentials();
}

async function loadCredentials(): Promise<void> {
  const response = await sendRuntimeRequest({
    type: "credentials.listForCurrentTab",
  });

  if (response.type !== "credentials.list") {
    setStatus("Unable to load credentials");
    return;
  }

  renderCredentials(response.credentials);
  setStatus(
    response.error ??
      `Found ${String(response.credentials.length)} credential(s)`,
  );
}

async function fillCredential(credentialId: string): Promise<void> {
  setStatus("Filling credential");
  const response = await sendRuntimeRequest({
    type: "credentials.fillCurrentTab",
    credentialId,
  });

  if (response.type !== "credentials.fillResult" || !response.ok) {
    setStatus(
      response.type === "credentials.fillResult" && response.error !== undefined
        ? response.error
        : "Unable to fill credential",
    );
    return;
  }

  setStatus("Credential filled");
}

async function validateToken(): Promise<void> {
  await checkConnection();
}

async function checkConnection(): Promise<void> {
  setStatus("Checking Vault connection");
  const response = await sendRuntimeRequest({ type: "auth.validateToken" });

  if (response.type !== "auth.validationResult") {
    setStatus("Unable to check Vault connection");
    return;
  }

  setStatus(
    response.ok
      ? "Vault connection is healthy; token is valid"
      : (response.error ?? "Vault connection or token validation failed"),
  );
}

async function loginWithOidc(): Promise<void> {
  setStatus("Starting OIDC login");
  const response = await sendRuntimeRequest({ type: "auth.loginOidc" });

  if (response.type !== "auth.oidcLoginResult") {
    setStatus("Unable to start OIDC login");
    return;
  }

  setStatus(
    response.ok
      ? "OIDC login succeeded"
      : (response.error ?? "OIDC login failed"),
  );
  await loadState();
}

async function loginWithApprole(): Promise<void> {
  setStatus("Starting AppRole login");
  const response = await sendRuntimeRequest({ type: "auth.loginApprole" });

  if (response.type !== "auth.approleLoginResult") {
    setStatus("Unable to start AppRole login");
    return;
  }

  setStatus(
    response.ok
      ? "AppRole login succeeded"
      : (response.error ?? "AppRole login failed"),
  );
  await loadState();
}

function renderCredentials(credentials: readonly CredentialSummary[]): void {
  credentialListElement.textContent = "";

  if (credentials.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No credentials for this origin";
    credentialListElement.append(item);
    return;
  }

  for (const credential of credentials) {
    const item = document.createElement("li");
    const username = document.createElement("span");
    const fillButton = document.createElement("button");
    const { secret, button: revealButton } = createRevealElements(credential);

    username.textContent = credential.username;
    fillButton.type = "button";
    fillButton.textContent = "Fill";
    fillButton.addEventListener("click", () => {
      void fillCredential(credential.id);
    });

    item.append(username, secret, revealButton, fillButton);
    credentialListElement.append(item);
  }
}

async function runSearch(query: string): Promise<void> {
  setStatus("Searching credentials");
  const response = await sendRuntimeRequest({
    type: "credentials.search",
    query,
  });

  if (response.type !== "credentials.searchResult") {
    setStatus("Unable to search credentials");
    return;
  }

  renderSearchResults(response.credentials);
  setStatus(
    response.error ??
      `Found ${String(response.credentials.length)} credential(s)`,
  );
}

function renderSearchResults(credentials: readonly CredentialSummary[]): void {
  searchResultsElement.textContent = "";

  if (credentials.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No matching credentials";
    searchResultsElement.append(item);
    return;
  }

  for (const credential of credentials) {
    const item = document.createElement("li");
    const origin = document.createElement("span");
    const username = document.createElement("span");
    const { secret, button: revealButton } = createRevealElements(credential);

    origin.className = "credential-origin";
    origin.textContent = credential.origin;
    username.textContent = credential.username;

    item.append(origin, username, secret, revealButton);
    searchResultsElement.append(item);
  }
}

function createRevealElements(credential: CredentialSummary): {
  readonly secret: HTMLSpanElement;
  readonly button: HTMLButtonElement;
} {
  const secret = document.createElement("span");
  secret.className = "credential-secret";
  secret.hidden = true;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Reveal";

  let cachedPassword: string | null = null;

  button.addEventListener("click", () => {
    void (async () => {
      if (!secret.hidden) {
        secret.hidden = true;
        secret.textContent = "";
        button.textContent = "Reveal";
        return;
      }

      if (cachedPassword === null) {
        button.disabled = true;
        const response = await sendRuntimeRequest({
          type: "credentials.reveal",
          origin: credential.origin,
          credentialId: credential.id,
        });
        button.disabled = false;

        if (response.type !== "credentials.revealResult" || !response.ok) {
          setStatus(
            response.type === "credentials.revealResult" &&
              response.error !== undefined
              ? response.error
              : "Unable to reveal password",
          );
          return;
        }

        cachedPassword = response.password ?? "";
      }

      secret.textContent = cachedPassword;
      secret.hidden = false;
      button.textContent = "Hide";
    })();
  });

  return { secret, button };
}

function authStateText(config: ExtensionConfig): string {
  if (config.authMode === "token") {
    return config.hasToken ? "Token configured" : "Token auth";
  }

  const label = config.authMode === "approle" ? "AppRole" : "OIDC";

  if (!config.hasToken) {
    return `${label} login required`;
  }

  if (config.tokenExpiresAt === null) {
    return `${label} token configured`;
  }

  const expiresAt = Date.parse(config.tokenExpiresAt);

  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    return `${label} token expired`;
  }

  return `${label} token until ${new Date(config.tokenExpiresAt).toLocaleString()}`;
}

async function sendRuntimeRequest(
  request: RuntimeRequest,
): Promise<RuntimeResponse> {
  return browser.runtime.sendMessage(request) as Promise<RuntimeResponse>;
}

function setStatus(message: string): void {
  statusElement.textContent = message;
}

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);

  if (element === null) {
    throw new Error(`Missing element: ${id}`);
  }

  return element;
}
