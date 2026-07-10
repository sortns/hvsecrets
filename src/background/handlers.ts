import { validateConfig } from "../shared/config";
import type { RuntimeRequest, RuntimeResponse } from "../shared/messages";
import type { CapturedCredentialInput } from "../shared/pending-credential";
import { normalizeOrigin } from "../shared/origin";
import { nowIsoString } from "../shared/clock";
import { VaultAppRoleClient } from "../vault/approle-client";
import { CredentialRepository } from "../vault/credential-repository";
import { VaultClientError } from "../vault/errors";
import { VaultKvV2Client } from "../vault/kv-v2-client";
import { VaultOidcClient } from "../vault/oidc-client";
import {
  addIgnoredOrigin,
  deletePendingCredential,
  getConfig,
  getPendingCredential,
  getSecrets,
  isIgnoredOrigin,
  listIgnoredOrigins,
  removeIgnoredOrigin,
  saveConfig,
  savePendingCredential,
  saveVaultToken,
  type ExtensionStorageArea,
} from "./storage";

export interface ExtensionTabsApi {
  readonly query: (queryInfo: {
    readonly active: true;
    readonly currentWindow: true;
  }) => Promise<ExtensionTab[]>;
  readonly sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
}

export interface ExtensionOidcTabFlowApi {
  readonly openAuthUrlAndWaitForCallback: (
    authUrl: string,
    callbackUrlPrefix: string,
  ) => Promise<string>;
}

export interface ExtensionTab {
  readonly id?: number;
  readonly url?: string;
  readonly title?: string;
}

export async function handleRuntimeRequest(
  request: RuntimeRequest,
  storage: ExtensionStorageArea,
  tabs: ExtensionTabsApi,
  sender: ExtensionMessageSender = {},
  oidcTabFlow?: ExtensionOidcTabFlowApi,
): Promise<RuntimeResponse> {
  switch (request.type) {
    case "config.get":
      return getConfigState(storage);
    case "config.save": {
      const config = await saveConfig(storage, request);

      return {
        type: "config.state",
        config,
        validation: validateConfig(config),
      };
    }
    case "auth.validateToken":
      return validateToken(storage);
    case "auth.loginOidc":
      return loginOidc(storage, oidcTabFlow);
    case "auth.loginApprole":
      return loginApprole(storage);
    case "settings.ignoredOrigins.list":
      return getIgnoredOrigins(storage);
    case "settings.ignoredOrigins.add":
      return addIgnoredOriginSetting(storage, request.origin);
    case "settings.ignoredOrigins.remove":
      return removeIgnoredOriginSetting(storage, request.origin);
    case "credentials.listForCurrentTab":
      return listCredentialsForCurrentTab(storage, tabs);
    case "credentials.listForSenderOrigin":
      return listCredentialsForSenderOrigin(storage, sender);
    case "credentials.saveForCurrentTab":
      return saveCredentialForCurrentTab(
        storage,
        tabs,
        request.username,
        request.password,
      );
    case "credentials.fillCurrentTab":
      return fillCredentialForCurrentTab(storage, tabs, request.credentialId);
    case "credentials.fillFirstForCurrentTab":
      return fillFirstCredentialForCurrentTab(storage, tabs);
    case "credentials.fillSenderOrigin":
      return fillCredentialForSenderOrigin(
        storage,
        tabs,
        sender,
        request.credentialId,
      );
    case "credentials.captureLoginAttempt":
      return captureLoginAttempt(storage, sender, request.credential);
    case "credentials.pendingForCurrentTab":
      return pendingCredentialForCurrentTab(storage, tabs);
    case "credentials.pendingForSenderOrigin":
      return pendingCredentialForSenderOrigin(storage, sender);
    case "credentials.savePendingForCurrentTab":
      return savePendingCredentialForCurrentTab(storage, tabs);
    case "credentials.savePendingForSenderOrigin":
      return savePendingCredentialForSenderOrigin(storage, sender);
    case "credentials.dismissPendingForCurrentTab":
      return dismissPendingCredentialForCurrentTab(storage, tabs);
    case "credentials.dismissPendingForSenderOrigin":
      return dismissPendingCredentialForSenderOrigin(storage, sender);
    case "credentials.ignoreSenderOrigin":
      return ignoreSenderOrigin(storage, sender);
    case "credentials.search":
      return searchCredentials(storage, request.query);
    case "credentials.reveal":
      return revealCredential(storage, request.origin, request.credentialId);
  }
}

export interface ExtensionMessageSender {
  readonly tab?: ExtensionTab;
}

async function getConfigState(
  storage: ExtensionStorageArea,
): Promise<RuntimeResponse> {
  const config = await getConfig(storage);

  return {
    type: "config.state",
    config,
    validation: validateConfig(config),
  };
}

async function validateToken(
  storage: ExtensionStorageArea,
): Promise<RuntimeResponse> {
  const config = await getConfig(storage);
  const secrets = await getSecrets(storage);

  if (
    secrets.vaultToken === undefined ||
    secrets.vaultToken.trim().length === 0
  ) {
    return {
      type: "auth.validationResult",
      ok: false,
      error: "Vault token is not configured",
    };
  }

  try {
    const client = new VaultKvV2Client({
      vaultUrl: config.vaultUrl,
      token: secrets.vaultToken,
      mount: config.kvMount,
      namespace: config.vaultNamespace,
    });

    return {
      type: "auth.validationResult",
      ok: true,
      token: await client.lookupSelf(),
    };
  } catch (error) {
    return {
      type: "auth.validationResult",
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Vault token validation failed",
    };
  }
}

async function loginOidc(
  storage: ExtensionStorageArea,
  oidcTabFlow?: ExtensionOidcTabFlowApi,
): Promise<RuntimeResponse> {
  if (oidcTabFlow === undefined) {
    return {
      type: "auth.oidcLoginResult",
      ok: false,
      error: "OIDC browser tab flow is not available",
    };
  }

  const config = await getConfig(storage);
  const redirectUri = "http://localhost:8250/oidc/callback";

  if (config.oidcRole.length === 0) {
    return {
      type: "auth.oidcLoginResult",
      ok: false,
      error: "OIDC role is required",
    };
  }

  try {
    const client = new VaultOidcClient({
      vaultUrl: config.vaultUrl,
      authMount: config.oidcAuthMount,
      namespace: config.vaultNamespace,
    });
    const authUrl = await client.createAuthUrl({
      role: config.oidcRole,
      redirectUri,
    });
    const callbackUrl = await oidcTabFlow.openAuthUrlAndWaitForCallback(
      authUrl.authUrl,
      redirectUri,
    );
    const callbackParams = new URL(callbackUrl).searchParams;
    const code = callbackParams.get("code");
    const state = callbackParams.get("state");

    if (code === null || state === null) {
      return {
        type: "auth.oidcLoginResult",
        ok: false,
        error: "OIDC callback did not include code and state",
        redirectUri,
      };
    }

    const result = await client.completeCallback({
      code,
      state,
      nonce: authUrl.nonce,
      clientNonce: authUrl.clientNonce,
    });

    await saveVaultToken(storage, {
      token: result.clientToken,
      leaseDuration: result.leaseDuration,
      renewable: result.renewable,
    });

    const updatedConfig = await getConfig(storage);

    return {
      type: "auth.oidcLoginResult",
      ok: true,
      tokenExpiresAt: updatedConfig.tokenExpiresAt,
      renewable: updatedConfig.tokenRenewable,
      redirectUri,
    };
  } catch (error) {
    return {
      type: "auth.oidcLoginResult",
      ok: false,
      error: error instanceof Error ? error.message : "OIDC login failed",
      redirectUri,
    };
  }
}

async function loginApprole(
  storage: ExtensionStorageArea,
): Promise<RuntimeResponse> {
  const config = await getConfig(storage);
  const secrets = await getSecrets(storage);

  if (config.approleRoleId.trim().length === 0) {
    return {
      type: "auth.approleLoginResult",
      ok: false,
      error: "AppRole role ID is required",
    };
  }

  const secretId = secrets.approleSecretId?.trim();

  if (secretId === undefined || secretId.length === 0) {
    return {
      type: "auth.approleLoginResult",
      ok: false,
      error: "AppRole secret ID is required",
    };
  }

  try {
    const client = new VaultAppRoleClient({
      vaultUrl: config.vaultUrl,
      authMount: config.approleAuthMount,
      namespace: config.vaultNamespace,
    });
    const result = await client.login({
      roleId: config.approleRoleId,
      secretId,
    });

    await saveVaultToken(storage, {
      token: result.clientToken,
      leaseDuration: result.leaseDuration,
      renewable: result.renewable,
    });

    const updatedConfig = await getConfig(storage);

    return {
      type: "auth.approleLoginResult",
      ok: true,
      tokenExpiresAt: updatedConfig.tokenExpiresAt,
      renewable: updatedConfig.tokenRenewable,
    };
  } catch (error) {
    return {
      type: "auth.approleLoginResult",
      ok: false,
      error: error instanceof Error ? error.message : "AppRole login failed",
    };
  }
}

async function listCredentialsForCurrentTab(
  storage: ExtensionStorageArea,
  tabs: ExtensionTabsApi,
): Promise<RuntimeResponse> {
  const currentTab = await getCurrentTab(tabs);
  const origin = getTabOrigin(currentTab);

  if (origin === null) {
    return {
      type: "credentials.list",
      origin,
      credentials: [],
      error: "Current tab does not have a fillable URL",
    };
  }

  const repository = await createCredentialRepository(storage);

  return {
    type: "credentials.list",
    origin,
    credentials: await repository.listForOrigin(origin),
  };
}

async function listCredentialsForSenderOrigin(
  storage: ExtensionStorageArea,
  sender: ExtensionMessageSender,
): Promise<RuntimeResponse> {
  const origin = getSenderOrigin(sender);

  if (origin === null) {
    return {
      type: "credentials.list",
      origin,
      credentials: [],
      error: "Sender page does not have a fillable URL",
    };
  }

  const repository = await createCredentialRepository(storage);

  return {
    type: "credentials.list",
    origin,
    credentials: await repository.listForOrigin(origin),
  };
}

async function searchCredentials(
  storage: ExtensionStorageArea,
  query: string,
): Promise<RuntimeResponse> {
  try {
    const repository = await createCredentialRepository(storage);
    const allCredentials = await repository.searchAll();
    const normalizedQuery = query.trim().toLowerCase();
    const credentials =
      normalizedQuery.length === 0
        ? allCredentials
        : allCredentials.filter(
            (credential) =>
              credential.origin.toLowerCase().includes(normalizedQuery) ||
              credential.url.toLowerCase().includes(normalizedQuery) ||
              credential.title.toLowerCase().includes(normalizedQuery) ||
              credential.username.toLowerCase().includes(normalizedQuery),
          );

    return {
      type: "credentials.searchResult",
      credentials,
    };
  } catch (error) {
    return {
      type: "credentials.searchResult",
      credentials: [],
      error: error instanceof Error ? error.message : "Credential search failed",
    };
  }
}

async function revealCredential(
  storage: ExtensionStorageArea,
  origin: string,
  credentialId: string,
): Promise<RuntimeResponse> {
  try {
    const repository = await createCredentialRepository(storage);
    const credential = await repository.getForOrigin(origin, credentialId);

    if (credential === null) {
      return {
        type: "credentials.revealResult",
        ok: false,
        error: "Credential was not found",
      };
    }

    return {
      type: "credentials.revealResult",
      ok: true,
      password: credential.password,
    };
  } catch (error) {
    return {
      type: "credentials.revealResult",
      ok: false,
      error: error instanceof Error ? error.message : "Credential reveal failed",
    };
  }
}

async function saveCredentialForCurrentTab(
  storage: ExtensionStorageArea,
  tabs: ExtensionTabsApi,
  username: string,
  password: string,
): Promise<RuntimeResponse> {
  const currentTab = await getCurrentTab(tabs);
  const origin = getTabOrigin(currentTab);

  if (origin === null || currentTab.url === undefined) {
    return {
      type: "credentials.saveResult",
      ok: false,
      error: "Current tab does not have a fillable URL",
    };
  }

  if (username.trim().length === 0 || password.length === 0) {
    return {
      type: "credentials.saveResult",
      ok: false,
      error: "Username and password are required",
    };
  }

  try {
    const repository = await createCredentialRepository(storage);
    const credential = await repository.saveOrUpdate({
      origin,
      username: username.trim(),
      password,
      url: currentTab.url,
      title: currentTab.title ?? "",
    });

    return {
      type: "credentials.saveResult",
      ok: true,
      credential,
    };
  } catch (error) {
    return {
      type: "credentials.saveResult",
      ok: false,
      error: describeCredentialSaveError(error),
    };
  }
}

async function fillCredentialForCurrentTab(
  storage: ExtensionStorageArea,
  tabs: ExtensionTabsApi,
  credentialId: string,
): Promise<RuntimeResponse> {
  const currentTab = await getCurrentTab(tabs);
  const origin = getTabOrigin(currentTab);

  if (origin === null || currentTab.id === undefined) {
    return {
      type: "credentials.fillResult",
      ok: false,
      error: "Current tab does not have a fillable URL",
    };
  }

  const repository = await createCredentialRepository(storage);
  const credential = await repository.getForOrigin(origin, credentialId);

  if (credential === null) {
    return {
      type: "credentials.fillResult",
      ok: false,
      error: "Credential was not found for this origin",
    };
  }

  try {
    await tabs.sendMessage(currentTab.id, {
      type: "content.fillCredential",
      credential: {
        username: credential.username,
        password: credential.password,
      },
    });

    return {
      type: "credentials.fillResult",
      ok: true,
    };
  } catch (error) {
    return {
      type: "credentials.fillResult",
      ok: false,
      error: error instanceof Error ? error.message : "Credential fill failed",
    };
  }
}

async function fillFirstCredentialForCurrentTab(
  storage: ExtensionStorageArea,
  tabs: ExtensionTabsApi,
): Promise<RuntimeResponse> {
  const currentTab = await getCurrentTab(tabs);
  const origin = getTabOrigin(currentTab);

  if (origin === null) {
    return {
      type: "credentials.fillResult",
      ok: false,
      error: "Current tab does not have a fillable URL",
    };
  }

  const repository = await createCredentialRepository(storage);
  const credentials = await repository.listForOrigin(origin);

  if (credentials.length === 0) {
    return {
      type: "credentials.fillResult",
      ok: false,
      error: "No credentials found for this origin",
    };
  }

  const credential = credentials[0];

  return fillCredentialForCurrentTab(storage, tabs, credential.id);
}

async function fillCredentialForSenderOrigin(
  storage: ExtensionStorageArea,
  tabs: ExtensionTabsApi,
  sender: ExtensionMessageSender,
  credentialId: string,
): Promise<RuntimeResponse> {
  const origin = getSenderOrigin(sender);
  const tabId = sender.tab?.id;

  if (origin === null || tabId === undefined) {
    return {
      type: "credentials.fillResult",
      ok: false,
      error: "Sender page does not have a fillable URL",
    };
  }

  const repository = await createCredentialRepository(storage);
  const credential = await repository.getForOrigin(origin, credentialId);

  if (credential === null) {
    return {
      type: "credentials.fillResult",
      ok: false,
      error: "Credential was not found for this origin",
    };
  }

  try {
    await tabs.sendMessage(tabId, {
      type: "content.fillCredential",
      credential: {
        username: credential.username,
        password: credential.password,
      },
    });

    return {
      type: "credentials.fillResult",
      ok: true,
    };
  } catch (error) {
    return {
      type: "credentials.fillResult",
      ok: false,
      error: error instanceof Error ? error.message : "Credential fill failed",
    };
  }
}

async function captureLoginAttempt(
  storage: ExtensionStorageArea,
  sender: ExtensionMessageSender,
  credential: CapturedCredentialInput,
): Promise<RuntimeResponse> {
  const origin = getTabOrigin(sender.tab ?? {});

  if (origin === null) {
    return {
      type: "credentials.captureResult",
      ok: false,
      error: "Submitted credential did not come from a fillable page",
    };
  }

  if (
    credential.username.trim().length === 0 ||
    credential.password.length === 0
  ) {
    return {
      type: "credentials.captureResult",
      ok: false,
      error: "Username and password are required",
    };
  }

  if (await isIgnoredOrigin(storage, origin)) {
    await deletePendingCredential(storage, origin);

    return {
      type: "credentials.captureResult",
      ok: false,
    };
  }

  const repository = await createCredentialRepository(storage);
  const normalizedCredential = {
    origin,
    url: credential.url,
    title: credential.title,
    username: credential.username.trim(),
    password: credential.password,
  };

  if (await repository.hasExactCredential(normalizedCredential)) {
    await deletePendingCredential(storage, origin);

    return {
      type: "credentials.captureResult",
      ok: false,
    };
  }

  await savePendingCredential(storage, {
    ...normalizedCredential,
    capturedAt: nowIsoString(),
  });

  return {
    type: "credentials.captureResult",
    ok: true,
  };
}

async function getIgnoredOrigins(
  storage: ExtensionStorageArea,
): Promise<RuntimeResponse> {
  return {
    type: "settings.ignoredOrigins",
    origins: await listIgnoredOrigins(storage),
  };
}

async function addIgnoredOriginSetting(
  storage: ExtensionStorageArea,
  origin: string,
): Promise<RuntimeResponse> {
  try {
    return {
      type: "settings.ignoredOrigins",
      origins: await addIgnoredOrigin(storage, origin),
    };
  } catch (error) {
    return {
      type: "settings.ignoredOrigins",
      origins: await listIgnoredOrigins(storage),
      error: error instanceof Error ? error.message : "Unable to ignore origin",
    };
  }
}

async function removeIgnoredOriginSetting(
  storage: ExtensionStorageArea,
  origin: string,
): Promise<RuntimeResponse> {
  try {
    return {
      type: "settings.ignoredOrigins",
      origins: await removeIgnoredOrigin(storage, origin),
    };
  } catch (error) {
    return {
      type: "settings.ignoredOrigins",
      origins: await listIgnoredOrigins(storage),
      error:
        error instanceof Error
          ? error.message
          : "Unable to remove ignored origin",
    };
  }
}

async function pendingCredentialForCurrentTab(
  storage: ExtensionStorageArea,
  tabs: ExtensionTabsApi,
): Promise<RuntimeResponse> {
  const currentTab = await getCurrentTab(tabs);
  const origin = getTabOrigin(currentTab);

  if (origin === null) {
    return {
      type: "credentials.pending",
      credential: null,
    };
  }

  return {
    type: "credentials.pending",
    credential: await getPendingCredential(storage, origin),
  };
}

async function pendingCredentialForSenderOrigin(
  storage: ExtensionStorageArea,
  sender: ExtensionMessageSender,
): Promise<RuntimeResponse> {
  const origin = getSenderOrigin(sender);

  if (origin === null) {
    return {
      type: "credentials.pending",
      credential: null,
    };
  }

  return {
    type: "credentials.pending",
    credential: await getPendingCredential(storage, origin),
  };
}

async function savePendingCredentialForCurrentTab(
  storage: ExtensionStorageArea,
  tabs: ExtensionTabsApi,
): Promise<RuntimeResponse> {
  const currentTab = await getCurrentTab(tabs);
  const origin = getTabOrigin(currentTab);

  if (origin === null) {
    return {
      type: "credentials.saveResult",
      ok: false,
      error: "Current tab does not have a fillable URL",
    };
  }

  const pendingCredential = await getPendingCredential(storage, origin);

  if (pendingCredential === null) {
    return {
      type: "credentials.saveResult",
      ok: false,
      error: "No captured credential for this origin",
    };
  }

  try {
    const repository = await createCredentialRepository(storage);
    const credential = await repository.saveOrUpdate({
      origin,
      username: pendingCredential.username,
      password: pendingCredential.password,
      url: pendingCredential.url,
      title: pendingCredential.title,
    });

    await deletePendingCredential(storage, origin);

    return {
      type: "credentials.saveResult",
      ok: true,
      credential,
    };
  } catch (error) {
    return {
      type: "credentials.saveResult",
      ok: false,
      error: describeCredentialSaveError(error),
    };
  }
}

async function savePendingCredentialForSenderOrigin(
  storage: ExtensionStorageArea,
  sender: ExtensionMessageSender,
): Promise<RuntimeResponse> {
  const origin = getSenderOrigin(sender);

  if (origin === null) {
    return {
      type: "credentials.saveResult",
      ok: false,
      error: "Sender page does not have a fillable URL",
    };
  }

  const pendingCredential = await getPendingCredential(storage, origin);

  if (pendingCredential === null) {
    return {
      type: "credentials.saveResult",
      ok: false,
      error: "No captured credential for this origin",
    };
  }

  try {
    const repository = await createCredentialRepository(storage);
    const credential = await repository.saveOrUpdate({
      origin,
      username: pendingCredential.username,
      password: pendingCredential.password,
      url: pendingCredential.url,
      title: pendingCredential.title,
    });

    await deletePendingCredential(storage, origin);

    return {
      type: "credentials.saveResult",
      ok: true,
      credential,
    };
  } catch (error) {
    return {
      type: "credentials.saveResult",
      ok: false,
      error: describeCredentialSaveError(error),
    };
  }
}

function describeCredentialSaveError(error: unknown): string {
  if (
    error instanceof VaultClientError &&
    (error.status === 401 || error.status === 403)
  ) {
    return "Vault session expired. Please log in again.";
  }

  return error instanceof Error ? error.message : "Credential save failed";
}

async function dismissPendingCredentialForCurrentTab(
  storage: ExtensionStorageArea,
  tabs: ExtensionTabsApi,
): Promise<RuntimeResponse> {
  const currentTab = await getCurrentTab(tabs);
  const origin = getTabOrigin(currentTab);

  if (origin !== null) {
    await deletePendingCredential(storage, origin);
  }

  return {
    type: "credentials.pending",
    credential: null,
  };
}

async function dismissPendingCredentialForSenderOrigin(
  storage: ExtensionStorageArea,
  sender: ExtensionMessageSender,
): Promise<RuntimeResponse> {
  const origin = getSenderOrigin(sender);

  if (origin !== null) {
    await deletePendingCredential(storage, origin);
  }

  return {
    type: "credentials.pending",
    credential: null,
  };
}

async function ignoreSenderOrigin(
  storage: ExtensionStorageArea,
  sender: ExtensionMessageSender,
): Promise<RuntimeResponse> {
  const origin = getSenderOrigin(sender);

  if (origin !== null) {
    await addIgnoredOrigin(storage, origin);
  }

  return {
    type: "credentials.pending",
    credential: null,
  };
}

async function createCredentialRepository(
  storage: ExtensionStorageArea,
): Promise<CredentialRepository> {
  const config = await getConfig(storage);
  const secrets = await getSecrets(storage);

  if (
    secrets.vaultToken === undefined ||
    secrets.vaultToken.trim().length === 0
  ) {
    throw new Error("Vault token is not configured");
  }

  return new CredentialRepository(
    new VaultKvV2Client({
      vaultUrl: config.vaultUrl,
      token: secrets.vaultToken,
      mount: config.kvMount,
      namespace: config.vaultNamespace,
    }),
    config.basePath,
  );
}

async function getCurrentTab(tabs: ExtensionTabsApi): Promise<ExtensionTab> {
  const queryResult = await tabs.query({ active: true, currentWindow: true });
  const tab = queryResult.at(0);

  if (tab === undefined) {
    throw new Error("No active tab found");
  }

  return tab;
}

function getTabOrigin(tab: ExtensionTab): string | null {
  if (tab.url === undefined) {
    return null;
  }

  try {
    const origin = normalizeOrigin(tab.url);

    return origin.startsWith("http://") || origin.startsWith("https://")
      ? origin
      : null;
  } catch {
    return null;
  }
}

function getSenderOrigin(sender: ExtensionMessageSender): string | null {
  return getTabOrigin(sender.tab ?? {});
}
