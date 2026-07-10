import { VaultClientError } from "./errors";
import { normalizeVaultPath, normalizeVaultUrl } from "./paths";

export interface VaultAppRoleClientConfig {
  readonly vaultUrl: string;
  readonly authMount: string;
  readonly namespace?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface VaultAppRoleLoginResult {
  readonly clientToken: string;
  readonly leaseDuration: number;
  readonly renewable: boolean;
}

interface VaultEnvelope {
  readonly auth?: {
    readonly client_token?: string;
    readonly lease_duration?: number;
    readonly renewable?: boolean;
  };
  readonly errors?: readonly string[];
}

export class VaultAppRoleClient {
  private readonly vaultUrl: string;
  private readonly authMount: string;
  private readonly namespace?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: VaultAppRoleClientConfig) {
    this.vaultUrl = normalizeVaultUrl(config.vaultUrl);
    this.authMount = normalizeVaultPath(config.authMount);
    this.namespace = config.namespace?.trim();
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async login(params: {
    readonly roleId: string;
    readonly secretId: string;
  }): Promise<VaultAppRoleLoginResult> {
    const response = await this.request(
      "POST",
      `/v1/auth/${this.authMount}/login`,
      {
        role_id: params.roleId,
        secret_id: params.secretId,
      },
    );
    const token = response.auth?.client_token;

    if (token === undefined || token.length === 0) {
      throw new Error("Vault AppRole login response did not include client token");
    }

    return {
      clientToken: token,
      leaseDuration: response.auth?.lease_duration ?? 0,
      renewable: response.auth?.renewable ?? false,
    };
  }

  private async request(
    method: string,
    apiPath: string,
    body?: unknown,
  ): Promise<VaultEnvelope> {
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
    const envelope = await parseVaultEnvelope(response);

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

async function parseVaultEnvelope(response: Response): Promise<VaultEnvelope> {
  const text = await response.text();

  if (text.trim().length === 0) {
    return {};
  }

  return JSON.parse(text) as VaultEnvelope;
}
