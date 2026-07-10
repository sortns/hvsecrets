import { normalizeVaultPath, normalizeVaultUrl } from "../vault/paths";

export type AuthMode = "token" | "oidc" | "approle";

export interface ExtensionConfig {
  readonly vaultUrl: string;
  readonly kvMount: string;
  readonly basePath: string;
  readonly authMode: AuthMode;
  readonly oidcAuthMount: string;
  readonly oidcRole: string;
  readonly approleAuthMount: string;
  readonly approleRoleId: string;
  readonly hasApproleSecretId: boolean;
  readonly vaultNamespace: string;
  readonly hasToken: boolean;
  readonly tokenExpiresAt: string | null;
  readonly tokenRenewable: boolean;
}

export interface ExtensionConfigInput {
  readonly vaultUrl: string;
  readonly kvMount: string;
  readonly basePath: string;
  readonly authMode: AuthMode;
  readonly oidcAuthMount?: string;
  readonly oidcRole?: string;
  readonly approleAuthMount?: string;
  readonly approleRoleId?: string;
  readonly vaultNamespace?: string;
}

export interface ExtensionSecrets {
  readonly vaultToken?: string;
  readonly tokenExpiresAt?: string | null;
  readonly tokenRenewable?: boolean;
  readonly approleSecretId?: string;
}

export interface ConfigValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export const configStorageKey = "hvSecrets.config";
export const secretsStorageKey = "hvSecrets.secrets";

export const defaultConfig: ExtensionConfig = {
  vaultUrl: envString("VITE_VAULT_URL", "http://127.0.0.1:8200"),
  kvMount: envString("VITE_VAULT_KV_MOUNT", "secret"),
  basePath: envString("VITE_VAULT_BASE_PATH", "hvsecrets"),
  authMode: "token",
  oidcAuthMount: envString("VITE_VAULT_OIDC_AUTH_MOUNT", "oidc"),
  oidcRole: envString("VITE_VAULT_OIDC_ROLE", "hvsecrets"),
  approleAuthMount: envString("VITE_VAULT_APPROLE_AUTH_MOUNT", "approle"),
  approleRoleId: envString("VITE_VAULT_APPROLE_ROLE_ID", ""),
  hasApproleSecretId: false,
  vaultNamespace: "",
  hasToken: false,
  tokenExpiresAt: null,
  tokenRenewable: false,
};

export interface TokenState {
  readonly hasToken: boolean;
  readonly tokenExpiresAt: string | null;
  readonly tokenRenewable: boolean;
  readonly hasApproleSecretId: boolean;
}

export function normalizeConfig(
  input: ExtensionConfigInput,
  tokenState: TokenState,
): ExtensionConfig {
  return {
    vaultUrl: normalizeVaultUrl(input.vaultUrl),
    kvMount: normalizeVaultPath(input.kvMount),
    basePath: normalizeVaultPath(input.basePath),
    authMode: input.authMode,
    oidcAuthMount: normalizeVaultPath(
      input.oidcAuthMount ?? defaultConfig.oidcAuthMount,
    ),
    oidcRole: (input.oidcRole ?? defaultConfig.oidcRole).trim(),
    approleAuthMount: normalizeVaultPath(
      input.approleAuthMount ?? defaultConfig.approleAuthMount,
    ),
    approleRoleId: (input.approleRoleId ?? defaultConfig.approleRoleId).trim(),
    vaultNamespace: (input.vaultNamespace ?? "").trim(),
    ...tokenState,
  };
}

export function validateConfig(
  config: ExtensionConfig,
): ConfigValidationResult {
  const errors: string[] = [];

  if (config.authMode === "token" && !config.hasToken) {
    errors.push("Vault token is required for token auth");
  }

  if (config.authMode === "oidc" && config.oidcRole.length === 0) {
    errors.push("OIDC role is required for OIDC auth");
  }

  if (config.authMode === "oidc" && !config.hasToken) {
    errors.push("OIDC login is required");
  }

  if (config.authMode === "oidc" && isExpiredToken(config.tokenExpiresAt)) {
    errors.push("OIDC token is expired; login again");
  }

  if (config.authMode === "approle" && config.approleRoleId.length === 0) {
    errors.push("AppRole role ID is required for AppRole auth");
  }

  if (config.authMode === "approle" && !config.hasApproleSecretId) {
    errors.push("AppRole secret ID is required for AppRole auth");
  }

  if (config.authMode === "approle" && !config.hasToken) {
    errors.push("AppRole login is required");
  }

  if (config.authMode === "approle" && isExpiredToken(config.tokenExpiresAt)) {
    errors.push("AppRole token is expired; login again");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function redactConfig(config: ExtensionConfig): ExtensionConfig {
  return {
    ...config,
    hasToken: config.hasToken,
  };
}

function envString(name: string, fallback: string): string {
  const value: unknown = import.meta.env[name];

  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function isExpiredToken(expiresAt: string | null): boolean {
  if (expiresAt === null) {
    return false;
  }

  const timestamp = Date.parse(expiresAt);

  return Number.isFinite(timestamp) && timestamp <= Date.now();
}
