import { VaultClientError } from "./errors";
import { joinVaultPath, normalizeVaultPath, normalizeVaultUrl } from "./paths";

export interface VaultKvV2ClientConfig {
  readonly vaultUrl: string;
  readonly token: string;
  readonly mount: string;
  readonly namespace?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface VaultKvMetadata {
  readonly version: number;
  readonly created_time?: string;
  readonly deletion_time?: string;
  readonly destroyed?: boolean;
}

export interface VaultKvReadResult<TData> {
  readonly data: TData;
  readonly metadata: VaultKvMetadata;
}

export interface VaultTokenLookupSelfResult {
  readonly accessor?: string;
  readonly display_name?: string;
  readonly entity_id?: string;
  readonly expire_time?: string | null;
  readonly renewable?: boolean;
  readonly ttl?: number;
}

interface VaultEnvelope<TData> {
  readonly data?: TData;
  readonly errors?: readonly string[];
}

interface VaultKvReadEnvelope<TData> {
  readonly data: TData;
  readonly metadata: VaultKvMetadata;
}

interface VaultKvWriteEnvelope {
  readonly created_time?: string;
  readonly deletion_time?: string;
  readonly destroyed?: boolean;
  readonly version: number;
}

interface VaultKvListEnvelope {
  readonly keys: readonly string[];
}

export class VaultKvV2Client {
  private readonly vaultUrl: string;
  private readonly token: string;
  private readonly mount: string;
  private readonly namespace?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: VaultKvV2ClientConfig) {
    this.vaultUrl = normalizeVaultUrl(config.vaultUrl);
    this.token = config.token.trim();
    this.mount = normalizeVaultPath(config.mount);
    this.namespace = config.namespace?.trim();
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);

    if (this.token.length === 0) {
      throw new Error("Vault token must not be empty");
    }
  }

  async lookupSelf(): Promise<VaultTokenLookupSelfResult> {
    const response = await this.request<VaultTokenLookupSelfResult>(
      "GET",
      "/v1/auth/token/lookup-self",
    );

    if (response.data === undefined) {
      throw new Error("Vault token lookup response did not include data");
    }

    return response.data;
  }

  async read<TData extends Record<string, unknown>>(
    path: string,
  ): Promise<VaultKvReadResult<TData>> {
    const response = await this.request<VaultKvReadEnvelope<TData>>(
      "GET",
      this.kvDataApiPath(path),
    );

    if (response.data === undefined) {
      throw new Error("Vault KV read response did not include data");
    }

    return {
      data: response.data.data,
      metadata: response.data.metadata,
    };
  }

  async write(
    path: string,
    data: Record<string, unknown>,
    options: { readonly cas?: number } = {},
  ): Promise<VaultKvMetadata> {
    const response = await this.request<VaultKvWriteEnvelope>(
      "POST",
      this.kvDataApiPath(path),
      {
        data,
        options: options.cas === undefined ? undefined : { cas: options.cas },
      },
    );

    if (response.data === undefined) {
      throw new Error("Vault KV write response did not include data");
    }

    return response.data;
  }

  async list(path: string): Promise<readonly string[]> {
    const response = await this.request<VaultKvListEnvelope>(
      "LIST",
      this.kvMetadataApiPath(path),
    );

    if (response.data === undefined) {
      throw new Error("Vault KV list response did not include data");
    }

    return response.data.keys;
  }

  async delete(path: string): Promise<void> {
    await this.request("DELETE", this.kvDataApiPath(path));
  }

  dataPath(path: string): string {
    return joinVaultPath(this.mount, "data", path);
  }

  metadataPath(path: string): string {
    return joinVaultPath(this.mount, "metadata", path);
  }

  private kvDataApiPath(path: string): string {
    return `/v1/${this.dataPath(path)}`;
  }

  private kvMetadataApiPath(path: string): string {
    return `/v1/${this.metadataPath(path)}`;
  }

  private async request<TData = never>(
    method: string,
    apiPath: string,
    body?: unknown,
  ): Promise<VaultEnvelope<TData>> {
    const headers = new Headers({
      "X-Vault-Token": this.token,
    });

    if (this.namespace !== undefined && this.namespace.length > 0) {
      headers.set("X-Vault-Namespace", this.namespace);
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
  if (response.status === 204) {
    return {};
  }

  const text = await response.text();

  if (text.trim().length === 0) {
    return {};
  }

  return JSON.parse(text) as VaultEnvelope<TData>;
}
