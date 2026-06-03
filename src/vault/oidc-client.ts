import { VaultClientError } from "./errors";
import { normalizeVaultPath, normalizeVaultUrl } from "./paths";

export interface VaultOidcClientConfig {
  readonly vaultUrl: string;
  readonly authMount: string;
  readonly namespace?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface VaultOidcAuthUrlResult {
  readonly authUrl: string;
  readonly nonce: string;
  readonly clientNonce: string;
  readonly redirectUri: string;
}

export interface VaultOidcCallbackResult {
  readonly clientToken: string;
  readonly leaseDuration: number;
  readonly renewable: boolean;
}

interface VaultEnvelope<TData> {
  readonly data?: TData;
  readonly auth?: {
    readonly client_token?: string;
    readonly lease_duration?: number;
    readonly renewable?: boolean;
  };
  readonly errors?: readonly string[];
}

interface AuthUrlEnvelope {
  readonly auth_url: string;
}

export class VaultOidcClient {
  private readonly vaultUrl: string;
  private readonly authMount: string;
  private readonly namespace?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: VaultOidcClientConfig) {
    this.vaultUrl = normalizeVaultUrl(config.vaultUrl);
    this.authMount = normalizeVaultPath(config.authMount);
    this.namespace = config.namespace?.trim();
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async createAuthUrl(params: {
    readonly role: string;
    readonly redirectUri: string;
  }): Promise<VaultOidcAuthUrlResult> {
    const clientNonce = crypto.randomUUID();
    const response = await this.request<AuthUrlEnvelope>(
      "POST",
      `/v1/auth/${this.authMount}/oidc/auth_url`,
      {
        role: params.role,
        redirect_uri: params.redirectUri,
        client_nonce: clientNonce,
      },
    );

    if (response.data === undefined) {
      throw new Error("Vault OIDC auth_url response did not include data");
    }

    if (response.data.auth_url.trim().length === 0) {
      throw new Error(
        "Vault OIDC auth_url response was empty. The redirect URI is probably not allowed by the Vault role.",
      );
    }

    const authUrl = new URL(
      response.data.auth_url.replaceAll("&amp;", "&"),
      this.vaultUrl,
    ).toString();
    const nonce = new URL(authUrl).searchParams.get("nonce");

    if (nonce === null || nonce.length === 0) {
      throw new Error(
        `Vault OIDC auth_url response did not include nonce. Returned URL: ${redactUrl(authUrl)}`,
      );
    }

    return {
      authUrl,
      nonce,
      clientNonce,
      redirectUri: params.redirectUri,
    };
  }

  async completeCallback(params: {
    readonly code: string;
    readonly state: string;
    readonly nonce: string;
    readonly clientNonce: string;
  }): Promise<VaultOidcCallbackResult> {
    const query = new URLSearchParams({
      code: params.code,
      state: params.state,
      nonce: params.nonce,
      client_nonce: params.clientNonce,
    });
    const response = await this.request(
      "GET",
      `/v1/auth/${this.authMount}/oidc/callback?${query.toString()}`,
    );
    const token = response.auth?.client_token;

    if (token === undefined || token.length === 0) {
      throw new Error(
        "Vault OIDC callback response did not include client token",
      );
    }

    return {
      clientToken: token,
      leaseDuration: response.auth?.lease_duration ?? 0,
      renewable: response.auth?.renewable ?? false,
    };
  }

  private async request<TData = never>(
    method: string,
    apiPath: string,
    body?: unknown,
  ): Promise<VaultEnvelope<TData>> {
    const headers = new Headers();

    if (this.namespace !== undefined && this.namespace.length > 0) {
      headers.set("X-Vault-Namespace", this.namespace);
    }

    if (body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    const response = await this.fetchImpl(`${this.vaultUrl}${apiPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = await parseVaultEnvelope<TData>(response);

    if (!response.ok) {
      throw new VaultClientError(
        `Vault request failed with status ${String(response.status)}`,
        response.status,
        envelope.errors ?? [],
      );
    }

    return envelope;
  }
}

async function parseVaultEnvelope<TData>(
  response: Response,
): Promise<VaultEnvelope<TData>> {
  const text = await response.text();

  if (text.trim().length === 0) {
    return {};
  }

  return JSON.parse(text) as VaultEnvelope<TData>;
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);

    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) {
        url.searchParams.set(key, "redacted");
      }
    }

    return url.toString();
  } catch {
    return value;
  }
}

function isSensitiveQueryKey(key: string): boolean {
  return [
    "code",
    "client_secret",
    "id_token",
    "access_token",
    "refresh_token",
  ].includes(key.toLowerCase());
}
