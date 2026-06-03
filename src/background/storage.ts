import {
  configStorageKey,
  defaultConfig,
  normalizeConfig,
  redactConfig,
  secretsStorageKey,
  type ExtensionConfig,
  type ExtensionConfigInput,
  type ExtensionSecrets,
  type TokenState
} from "../shared/config";
import { normalizeOrigin } from "../shared/origin";
import type { PendingCredential } from "../shared/pending-credential";

export const pendingCredentialStorageKey = "firefoxVault.pendingCredentials";
export const ignoredOriginsStorageKey = "firefoxVault.ignoredOrigins";

export interface ExtensionStorageArea {
  readonly get: (
    keys?: string | string[] | Record<string, unknown> | null
  ) => Promise<Record<string, unknown>>;
  readonly set: (items: Record<string, unknown>) => Promise<void>;
}

export interface SaveConfigRequest {
  readonly config: ExtensionConfigInput;
  readonly vaultToken?: string;
  readonly clearToken?: boolean;
}

export interface SaveVaultTokenRequest {
  readonly token: string;
  readonly leaseDuration?: number;
  readonly renewable?: boolean;
}

export async function getConfig(storage: ExtensionStorageArea): Promise<ExtensionConfig> {
  const secrets = await getSecrets(storage);
  const stored = await storage.get(configStorageKey);
  const maybeConfig = stored[configStorageKey];

  if (!isStoredConfig(maybeConfig)) {
    return {
      ...defaultConfig,
      ...tokenStateFromSecrets(secrets)
    };
  }

  return redactConfig({
    ...maybeConfig,
    ...tokenStateFromSecrets(secrets)
  });
}

export async function saveConfig(
  storage: ExtensionStorageArea,
  request: SaveConfigRequest
): Promise<ExtensionConfig> {
  const existingSecrets = await getSecrets(storage);
  const requestedToken = request.vaultToken?.trim();
  const nextToken =
    request.clearToken === true
      ? undefined
      : requestedToken !== undefined && requestedToken.length > 0
        ? requestedToken
        : existingSecrets.vaultToken?.trim();
  const isNewToken =
    requestedToken !== undefined &&
    requestedToken.length > 0 &&
    requestedToken !== existingSecrets.vaultToken?.trim();
  const nextSecrets: ExtensionSecrets =
    nextToken === undefined
      ? {}
      : {
          vaultToken: nextToken,
          tokenExpiresAt: isNewToken ? null : (existingSecrets.tokenExpiresAt ?? null),
          tokenRenewable: isNewToken ? false : (existingSecrets.tokenRenewable ?? false)
        };
  const nextConfig = normalizeConfig(request.config, tokenStateFromSecrets(nextSecrets));

  await storage.set({
    [configStorageKey]: nextConfig,
    [secretsStorageKey]: nextSecrets
  });

  return redactConfig(nextConfig);
}

export async function getSecrets(storage: ExtensionStorageArea): Promise<ExtensionSecrets> {
  const stored = await storage.get(secretsStorageKey);
  const maybeSecrets = stored[secretsStorageKey];

  if (!isStoredSecrets(maybeSecrets)) {
    return {};
  }

  return maybeSecrets;
}

export async function saveVaultToken(
  storage: ExtensionStorageArea,
  request: SaveVaultTokenRequest
): Promise<void> {
  const existingSecrets = await getSecrets(storage);
  const tokenExpiresAt =
    request.leaseDuration === undefined || request.leaseDuration <= 0
      ? null
      : new Date(Date.now() + request.leaseDuration * 1000).toISOString();

  await storage.set({
    [secretsStorageKey]: {
      ...existingSecrets,
      vaultToken: request.token,
      tokenExpiresAt,
      tokenRenewable: request.renewable ?? false
    }
  });
}

export async function savePendingCredential(
  storage: ExtensionStorageArea,
  credential: PendingCredential
): Promise<void> {
  const pending = await getPendingCredentials(storage);

  await storage.set({
    [pendingCredentialStorageKey]: {
      ...pending,
      [credential.origin]: credential
    }
  });
}

export async function getPendingCredential(
  storage: ExtensionStorageArea,
  origin: string
): Promise<PendingCredential | null> {
  const pending = await getPendingCredentials(storage);

  return pending[origin] ?? null;
}

export async function deletePendingCredential(
  storage: ExtensionStorageArea,
  origin: string
): Promise<void> {
  const pending = await getPendingCredentials(storage);
  const nextPending = Object.fromEntries(
    Object.entries(pending).filter(([pendingOrigin]) => pendingOrigin !== origin)
  );

  await storage.set({
    [pendingCredentialStorageKey]: nextPending
  });
}

export async function listIgnoredOrigins(
  storage: ExtensionStorageArea
): Promise<readonly string[]> {
  const ignoredOrigins = await getIgnoredOriginSet(storage);

  return [...ignoredOrigins].sort();
}

export async function addIgnoredOrigin(
  storage: ExtensionStorageArea,
  originInput: string
): Promise<readonly string[]> {
  const origin = normalizeOrigin(originInput);
  const ignoredOrigins = await getIgnoredOriginSet(storage);
  ignoredOrigins.add(origin);

  await storage.set({
    [ignoredOriginsStorageKey]: [...ignoredOrigins].sort()
  });
  await deletePendingCredential(storage, origin);

  return [...ignoredOrigins].sort();
}

export async function removeIgnoredOrigin(
  storage: ExtensionStorageArea,
  originInput: string
): Promise<readonly string[]> {
  const origin = normalizeOrigin(originInput);
  const ignoredOrigins = await getIgnoredOriginSet(storage);
  ignoredOrigins.delete(origin);

  await storage.set({
    [ignoredOriginsStorageKey]: [...ignoredOrigins].sort()
  });

  return [...ignoredOrigins].sort();
}

export async function isIgnoredOrigin(
  storage: ExtensionStorageArea,
  originInput: string
): Promise<boolean> {
  const origin = normalizeOrigin(originInput);
  const ignoredOrigins = await getIgnoredOriginSet(storage);

  return ignoredOrigins.has(origin);
}

function hasUsableToken(secrets: ExtensionSecrets): boolean {
  return secrets.vaultToken !== undefined && secrets.vaultToken.trim().length > 0;
}

function tokenStateFromSecrets(secrets: ExtensionSecrets): TokenState {
  return {
    hasToken: hasUsableToken(secrets),
    tokenExpiresAt: secrets.tokenExpiresAt ?? null,
    tokenRenewable: secrets.tokenRenewable ?? false
  };
}

function isStoredConfig(value: unknown): value is ExtensionConfig {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.vaultUrl === "string" &&
    typeof value.kvMount === "string" &&
    typeof value.basePath === "string" &&
    (value.authMode === "token" || value.authMode === "oidc") &&
    typeof value.oidcAuthMount === "string" &&
    typeof value.oidcRole === "string" &&
    typeof value.vaultNamespace === "string"
  );
}

function isStoredSecrets(value: unknown): value is ExtensionSecrets {
  return (
    isRecord(value) &&
    (value.vaultToken === undefined || typeof value.vaultToken === "string") &&
    (value.tokenExpiresAt === undefined ||
      value.tokenExpiresAt === null ||
      typeof value.tokenExpiresAt === "string") &&
    (value.tokenRenewable === undefined || typeof value.tokenRenewable === "boolean")
  );
}

async function getPendingCredentials(
  storage: ExtensionStorageArea
): Promise<Record<string, PendingCredential>> {
  const stored = await storage.get(pendingCredentialStorageKey);
  const value = stored[pendingCredentialStorageKey];

  if (!isRecord(value)) {
    return {};
  }

  const pending: Record<string, PendingCredential> = {};

  for (const [origin, credential] of Object.entries(value)) {
    if (isPendingCredential(credential)) {
      pending[origin] = credential;
    }
  }

  return pending;
}

async function getIgnoredOriginSet(storage: ExtensionStorageArea): Promise<Set<string>> {
  const stored = await storage.get(ignoredOriginsStorageKey);
  const value = stored[ignoredOriginsStorageKey];

  if (!Array.isArray(value)) {
    return new Set();
  }

  const origins = new Set<string>();

  for (const origin of value) {
    if (typeof origin !== "string") {
      continue;
    }

    try {
      origins.add(normalizeOrigin(origin));
    } catch {
      // Ignore invalid legacy entries.
    }
  }

  return origins;
}

function isPendingCredential(value: unknown): value is PendingCredential {
  return (
    isRecord(value) &&
    typeof value.origin === "string" &&
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    typeof value.username === "string" &&
    typeof value.password === "string" &&
    typeof value.capturedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
