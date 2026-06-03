import type {
  ExtensionConfig,
  ExtensionConfigInput,
  ConfigValidationResult,
} from "./config";
import type { VaultTokenLookupSelfResult } from "../vault/kv-v2-client";
import type { CredentialSummary } from "../vault/credential-repository";
import type {
  CapturedCredentialInput,
  PendingCredential,
} from "./pending-credential";

const maxUrlLength = 4096;
const maxTitleLength = 512;
const maxUsernameLength = 512;
const maxPasswordLength = 4096;
const credentialIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RuntimeRequest =
  | { readonly type: "config.get" }
  | {
      readonly type: "config.save";
      readonly config: ExtensionConfigInput;
      readonly vaultToken?: string;
      readonly clearToken?: boolean;
    }
  | { readonly type: "auth.validateToken" }
  | { readonly type: "auth.loginOidc" }
  | { readonly type: "settings.ignoredOrigins.list" }
  | { readonly type: "settings.ignoredOrigins.add"; readonly origin: string }
  | { readonly type: "settings.ignoredOrigins.remove"; readonly origin: string }
  | { readonly type: "credentials.listForCurrentTab" }
  | { readonly type: "credentials.listForSenderOrigin" }
  | {
      readonly type: "credentials.saveForCurrentTab";
      readonly username: string;
      readonly password: string;
    }
  | {
      readonly type: "credentials.fillCurrentTab";
      readonly credentialId: string;
    }
  | { readonly type: "credentials.fillFirstForCurrentTab" }
  | {
      readonly type: "credentials.fillSenderOrigin";
      readonly credentialId: string;
    }
  | {
      readonly type: "credentials.captureLoginAttempt";
      readonly credential: CapturedCredentialInput;
    }
  | { readonly type: "credentials.pendingForCurrentTab" }
  | { readonly type: "credentials.pendingForSenderOrigin" }
  | { readonly type: "credentials.savePendingForCurrentTab" }
  | { readonly type: "credentials.savePendingForSenderOrigin" }
  | { readonly type: "credentials.dismissPendingForCurrentTab" }
  | { readonly type: "credentials.dismissPendingForSenderOrigin" }
  | { readonly type: "credentials.ignoreSenderOrigin" };

export type RuntimeResponse =
  | {
      readonly type: "config.state";
      readonly config: ExtensionConfig;
      readonly validation: ConfigValidationResult;
    }
  | {
      readonly type: "auth.validationResult";
      readonly ok: boolean;
      readonly token?: VaultTokenLookupSelfResult;
      readonly error?: string;
    }
  | {
      readonly type: "auth.oidcLoginResult";
      readonly ok: boolean;
      readonly tokenExpiresAt?: string | null;
      readonly renewable?: boolean;
      readonly redirectUri?: string;
      readonly error?: string;
    }
  | {
      readonly type: "settings.ignoredOrigins";
      readonly origins: readonly string[];
      readonly error?: string;
    }
  | {
      readonly type: "credentials.list";
      readonly origin: string | null;
      readonly credentials: readonly CredentialSummary[];
      readonly error?: string;
    }
  | {
      readonly type: "credentials.saveResult";
      readonly ok: boolean;
      readonly credential?: CredentialSummary;
      readonly error?: string;
    }
  | {
      readonly type: "credentials.fillResult";
      readonly ok: boolean;
      readonly error?: string;
    }
  | {
      readonly type: "credentials.pending";
      readonly credential: PendingCredential | null;
    }
  | {
      readonly type: "credentials.captureResult";
      readonly ok: boolean;
      readonly error?: string;
    };

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "config.get":
    case "credentials.listForCurrentTab":
    case "credentials.listForSenderOrigin":
    case "credentials.pendingForCurrentTab":
    case "credentials.pendingForSenderOrigin":
    case "credentials.savePendingForCurrentTab":
    case "credentials.savePendingForSenderOrigin":
    case "credentials.dismissPendingForCurrentTab":
    case "credentials.dismissPendingForSenderOrigin":
    case "auth.validateToken":
    case "auth.loginOidc":
    case "settings.ignoredOrigins.list":
    case "credentials.ignoreSenderOrigin":
      return true;
    case "settings.ignoredOrigins.add":
    case "settings.ignoredOrigins.remove":
      return (
        isBoundedString(value.origin, maxUrlLength, true) &&
        isHttpUrl(value.origin)
      );
    case "config.save":
      return isConfigSaveRequest(value);
    case "credentials.saveForCurrentTab":
      return (
        isBoundedString(value.username, maxUsernameLength, true) &&
        isBoundedString(value.password, maxPasswordLength, false)
      );
    case "credentials.fillFirstForCurrentTab":
      return true;
    case "credentials.fillCurrentTab":
    case "credentials.fillSenderOrigin":
      return (
        typeof value.credentialId === "string" &&
        credentialIdPattern.test(value.credentialId)
      );
    case "credentials.captureLoginAttempt":
      return isCapturedCredentialInput(value.credential);
    default:
      return false;
  }
}

function isConfigSaveRequest(value: Record<string, unknown>): boolean {
  return (
    isRecord(value.config) &&
    isBoundedString(value.config.vaultUrl, maxUrlLength, true) &&
    isBoundedString(value.config.kvMount, maxUrlLength, true) &&
    isBoundedString(value.config.basePath, maxUrlLength, true) &&
    (value.config.authMode === "token" || value.config.authMode === "oidc") &&
    (value.config.oidcAuthMount === undefined ||
      isBoundedString(value.config.oidcAuthMount, maxUrlLength, true)) &&
    (value.config.oidcRole === undefined ||
      isBoundedString(value.config.oidcRole, maxUsernameLength, true)) &&
    (value.config.vaultNamespace === undefined ||
      isBoundedString(value.config.vaultNamespace, maxUrlLength, false)) &&
    (value.vaultToken === undefined ||
      isBoundedString(value.vaultToken, maxPasswordLength, true)) &&
    (value.clearToken === undefined || typeof value.clearToken === "boolean")
  );
}

function isCapturedCredentialInput(
  value: unknown,
): value is CapturedCredentialInput {
  return (
    isRecord(value) &&
    isBoundedString(value.url, maxUrlLength, true) &&
    isHttpUrl(value.url) &&
    isBoundedString(value.title, maxTitleLength, false) &&
    isBoundedString(value.username, maxUsernameLength, true) &&
    isBoundedString(value.password, maxPasswordLength, false)
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isBoundedString(
  value: unknown,
  maxLength: number,
  requireNonBlank: boolean,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (!requireNonBlank || value.trim().length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
