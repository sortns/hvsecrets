import "./styles.css";
import type { AuthMode, ExtensionConfig } from "../shared/config";
import type { RuntimeRequest, RuntimeResponse } from "../shared/messages";

const form = getElement("options-form") as HTMLFormElement;
const statusElement = getElement("status") as HTMLParagraphElement;
const validateButton = getElement("validate-token") as HTMLButtonElement;
const oidcLoginButton = getElement("login-oidc") as HTMLButtonElement;
const oidcRedirectUriElement = getElement("oidc-redirect-uri");
const ignoredOriginForm = getElement("ignored-origin-form") as HTMLFormElement;
const ignoredOriginsElement = getElement("ignored-origins");
const tokenFields = getElement("token-fields");
const oidcFields = getElement("oidc-fields");

void loadConfig();
void loadIgnoredOrigins();

form.addEventListener("change", updateAuthModeVisibility);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveConfig();
});
validateButton.addEventListener("click", () => {
  void validateToken();
});
oidcLoginButton.addEventListener("click", () => {
  void loginWithOidc();
});
ignoredOriginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void addIgnoredOriginFromForm();
});

async function loadConfig(): Promise<void> {
  const response = await sendRuntimeRequest({ type: "config.get" });

  if (response.type !== "config.state") {
    setStatus("Unable to load configuration");
    return;
  }

  applyConfig(response.config);
  setStatus(
    response.validation.ok ? "Configuration loaded" : response.validation.errors.join(". ")
  );

  if (response.validation.ok) {
    void checkConnection();
  }
}

async function saveConfig(): Promise<void> {
  const response = await saveCurrentFormConfig();

  if (response.type !== "config.state") {
    setStatus("Unable to save configuration");
    return;
  }

  applyConfig(response.config);
  setStatus(response.validation.ok ? "Configuration saved" : response.validation.errors.join(". "));
}

async function saveCurrentFormConfig(): Promise<RuntimeResponse> {
  const formData = new FormData(form);
  const vaultToken = stringField(formData, "vaultToken").trim();

  return sendRuntimeRequest({
    type: "config.save",
    config: {
      vaultUrl: stringField(formData, "vaultUrl"),
      kvMount: stringField(formData, "kvMount"),
      basePath: stringField(formData, "basePath"),
      authMode: authModeField(formData),
      oidcAuthMount: stringField(formData, "oidcAuthMount"),
      oidcRole: stringField(formData, "oidcRole"),
      vaultNamespace: stringField(formData, "vaultNamespace")
    },
    vaultToken: vaultToken.length === 0 ? undefined : vaultToken,
    clearToken: formData.get("clearToken") === "on"
  });
}

async function validateToken(): Promise<void> {
  setStatus("Saving configuration");
  const saveResponse = await saveCurrentFormConfig();

  if (saveResponse.type !== "config.state") {
    setStatus("Unable to save configuration");
    return;
  }

  applyConfig(saveResponse.config);

  if (!saveResponse.validation.ok) {
    setStatus(saveResponse.validation.errors.join(". "));
    return;
  }

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
      : (response.error ?? "Vault connection or token validation failed")
  );
}

async function loginWithOidc(): Promise<void> {
  setStatus("Saving configuration");
  const saveResponse = await saveCurrentFormConfig();

  if (saveResponse.type !== "config.state") {
    setStatus("Unable to save configuration");
    return;
  }

  applyConfig(saveResponse.config);
  setStatus("Starting OIDC login");
  const response = await sendRuntimeRequest({ type: "auth.loginOidc" });

  if (response.type !== "auth.oidcLoginResult") {
    setStatus("Unable to start OIDC login");
    return;
  }

  if (response.redirectUri !== undefined) {
    oidcRedirectUriElement.textContent = `Vault OIDC redirect URI: ${response.redirectUri}`;
  }

  setStatus(response.ok ? "OIDC login succeeded" : (response.error ?? "OIDC login failed"));
}

async function loadIgnoredOrigins(): Promise<void> {
  const response = await sendRuntimeRequest({ type: "settings.ignoredOrigins.list" });

  if (response.type !== "settings.ignoredOrigins") {
    setStatus("Unable to load ignored origins");
    return;
  }

  renderIgnoredOrigins(response.origins);
}

async function addIgnoredOriginFromForm(): Promise<void> {
  const formData = new FormData(ignoredOriginForm);
  const origin = stringField(formData, "ignoredOrigin").trim();

  if (origin.length === 0) {
    return;
  }

  const response = await sendRuntimeRequest({
    type: "settings.ignoredOrigins.add",
    origin
  });

  if (response.type !== "settings.ignoredOrigins") {
    setStatus("Unable to add ignored origin");
    return;
  }

  ignoredOriginForm.reset();
  renderIgnoredOrigins(response.origins);
  setStatus(response.error ?? "Ignored origin added");
}

async function removeIgnoredOrigin(origin: string): Promise<void> {
  const response = await sendRuntimeRequest({
    type: "settings.ignoredOrigins.remove",
    origin
  });

  if (response.type !== "settings.ignoredOrigins") {
    setStatus("Unable to remove ignored origin");
    return;
  }

  renderIgnoredOrigins(response.origins);
  setStatus(response.error ?? "Ignored origin removed");
}

function renderIgnoredOrigins(origins: readonly string[]): void {
  ignoredOriginsElement.textContent = "";

  if (origins.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No ignored origins";
    ignoredOriginsElement.append(item);
    return;
  }

  for (const origin of origins) {
    const item = document.createElement("li");
    const originText = document.createElement("span");
    const removeButton = document.createElement("button");

    originText.textContent = origin;
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      void removeIgnoredOrigin(origin);
    });

    item.append(originText, removeButton);
    ignoredOriginsElement.append(item);
  }
}

function applyConfig(config: ExtensionConfig): void {
  setInputValue("vault-url", config.vaultUrl);
  setInputValue("kv-mount", config.kvMount);
  setInputValue("base-path", config.basePath);
  setInputValue("vault-namespace", config.vaultNamespace);
  setInputValue("oidc-auth-mount", config.oidcAuthMount);
  setInputValue("oidc-role", config.oidcRole);
  setInputValue("vault-token", "");
  setChecked("clear-token", false);
  oidcRedirectUriElement.textContent = "";

  const authModeInput = document.querySelector<HTMLInputElement>(
    `input[name="authMode"][value="${config.authMode}"]`
  );
  authModeInput?.click();
  updateAuthModeVisibility();
}

function updateAuthModeVisibility(): void {
  const authMode = authModeField(new FormData(form));
  tokenFields.hidden = authMode !== "token";
  oidcFields.hidden = authMode !== "oidc";
}

async function sendRuntimeRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  return browser.runtime.sendMessage(request) as Promise<RuntimeResponse>;
}

function stringField(formData: FormData, name: string): string {
  const value = formData.get(name);

  return typeof value === "string" ? value : "";
}

function authModeField(formData: FormData): AuthMode {
  return stringField(formData, "authMode") === "oidc" ? "oidc" : "token";
}

function setInputValue(id: string, value: string): void {
  (getElement(id) as HTMLInputElement).value = value;
}

function setChecked(id: string, value: boolean): void {
  (getElement(id) as HTMLInputElement).checked = value;
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
