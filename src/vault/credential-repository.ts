import { randomId } from "../shared/random";
import { normalizeOrigin, originPathSegment } from "../shared/origin";
import {
  assertCredentialRecord,
  createCredentialRecord,
  updateCredentialRecord,
  type CredentialRecord,
  type NewCredentialRecordInput,
} from "./credential";
import { mapWithConcurrency } from "../shared/concurrency";
import { VaultClientError } from "./errors";
import { joinVaultPath } from "./paths";

// Enough parallelism to hide round-trip latency on a large tree without
// flooding Vault (Firefox caps HTTP/1.1 connections per host at 6 anyway).
const vaultRequestConcurrency = 16;

export interface CredentialKvClient {
  readonly write: (
    path: string,
    data: Record<string, unknown>,
    options?: { readonly cas?: number },
  ) => Promise<unknown>;
  readonly list: (path: string) => Promise<readonly string[]>;
  readonly read: (path: string) => Promise<{
    readonly data: Record<string, unknown>;
    readonly metadata?: { readonly version?: number };
  }>;
  readonly deleteMetadata: (path: string) => Promise<void>;
}

export interface CredentialSummary {
  readonly id: string;
  readonly origin: string;
  readonly username: string;
  readonly url: string;
  readonly title: string;
  readonly updated_at: string;
}

export interface SaveCredentialInput {
  readonly origin: string;
  readonly username: string;
  readonly password: string;
  readonly url: string;
  readonly title?: string;
}

export class CredentialRepository {
  constructor(
    private readonly client: CredentialKvClient,
    private readonly basePath: string,
  ) {}

  async save(input: SaveCredentialInput): Promise<CredentialSummary> {
    const origin = normalizeOrigin(input.origin);
    const credential = createCredentialRecord({
      ...input,
      origin,
    } satisfies NewCredentialRecordInput);
    const id = randomId();

    await this.client.write(
      this.credentialPath(origin, id),
      credential as unknown as Record<string, unknown>,
      {
        cas: 0,
      },
    );

    return toSummary(id, credential);
  }

  async saveOrUpdate(input: SaveCredentialInput): Promise<CredentialSummary> {
    const origin = normalizeOrigin(input.origin);
    const existing = await this.findByUsername(origin, input.username);

    if (existing === null) {
      return this.save({
        ...input,
        origin,
      });
    }

    if (
      existing.credential.password === input.password &&
      existing.credential.url === input.url &&
      existing.credential.title === (input.title ?? "")
    ) {
      return toSummary(existing.id, existing.credential);
    }

    const credential = updateCredentialRecord(existing.credential, {
      ...input,
      origin,
    });

    await this.client.write(
      this.credentialPath(origin, existing.id),
      credential as unknown as Record<string, unknown>,
      existing.version === undefined ? undefined : { cas: existing.version },
    );

    return toSummary(existing.id, credential);
  }

  async hasExactCredential(input: SaveCredentialInput): Promise<boolean> {
    const origin = normalizeOrigin(input.origin);
    const existing = await this.findByUsername(origin, input.username);

    return existing !== null && existing.credential.password === input.password;
  }

  async listForOrigin(
    originInput: string,
  ): Promise<readonly CredentialSummary[]> {
    const origin = normalizeOrigin(originInput);

    return this.listCredentialsAtPath(this.originCredentialsPath(origin));
  }

  async searchAll(): Promise<readonly CredentialSummary[]> {
    const rootPath = joinVaultPath(this.basePath, "credentials");
    let originSegments: readonly string[];

    try {
      originSegments = await this.client.list(rootPath);
    } catch (error) {
      rethrowAuthError(error);
      return [];
    }

    const originPaths = originSegments
      .filter((segment) => segment.endsWith("/"))
      .map((segment) => joinVaultPath(rootPath, segment));
    const credentialIdsByOrigin = await mapWithConcurrency(
      originPaths,
      vaultRequestConcurrency,
      async (originPath) => ({
        originPath,
        ids: await this.listCredentialIds(originPath),
      }),
    );

    // Flatten before reading so one origin with many entries doesn't
    // serialize behind its own small worker pool.
    return this.readSummaries(
      credentialIdsByOrigin.flatMap(({ originPath, ids }) =>
        ids.map((id) => ({ basePath: originPath, id })),
      ),
    );
  }

  async delete(originInput: string, id: string): Promise<boolean> {
    const origin = normalizeOrigin(originInput);
    const existing = await this.getForOrigin(origin, id);

    if (existing === null) {
      return false;
    }

    // Deleting metadata removes every version, so the key also disappears
    // from LIST and doesn't cost a dead read on every later search.
    await this.client.deleteMetadata(this.credentialPath(origin, id));

    return true;
  }

  private async listCredentialsAtPath(
    basePath: string,
  ): Promise<readonly CredentialSummary[]> {
    const ids = await this.listCredentialIds(basePath);

    return this.readSummaries(ids.map((id) => ({ basePath, id })));
  }

  private async listCredentialIds(basePath: string): Promise<string[]> {
    try {
      const keys = await this.client.list(basePath);

      return keys.filter((key) => !key.endsWith("/"));
    } catch (error) {
      rethrowAuthError(error);
      return [];
    }
  }

  private async readSummaries(
    entries: readonly { readonly basePath: string; readonly id: string }[],
  ): Promise<readonly CredentialSummary[]> {
    const credentials = await mapWithConcurrency(
      entries,
      vaultRequestConcurrency,
      async ({ basePath, id }): Promise<CredentialSummary | null> => {
        try {
          const result = await this.client.read(joinVaultPath(basePath, id));
          assertCredentialRecord(result.data);

          return toSummary(id, result.data);
        } catch (error) {
          rethrowAuthError(error);
          return null;
        }
      },
    );

    return credentials.filter(
      (credential): credential is CredentialSummary => credential !== null,
    );
  }

  async getForOrigin(
    originInput: string,
    id: string,
  ): Promise<CredentialRecord | null> {
    const origin = normalizeOrigin(originInput);

    try {
      const result = await this.client.read(this.credentialPath(origin, id));
      assertCredentialRecord(result.data);

      if (result.data.origin !== origin) {
        return null;
      }

      return result.data;
    } catch (error) {
      rethrowAuthError(error);
      return null;
    }
  }

  private originCredentialsPath(origin: string): string {
    return joinVaultPath(
      this.basePath,
      "credentials",
      originPathSegment(origin),
    );
  }

  private credentialPath(origin: string, id: string): string {
    return joinVaultPath(this.originCredentialsPath(origin), id);
  }

  private async findByUsername(
    origin: string,
    username: string,
  ): Promise<{
    readonly id: string;
    readonly credential: CredentialRecord;
    readonly version?: number;
  } | null> {
    const credentials = await this.listForOrigin(origin);
    const matchingCredential = credentials.find(
      (credential) => credential.username === username,
    );

    if (matchingCredential === undefined) {
      return null;
    }

    try {
      const result = await this.client.read(
        this.credentialPath(origin, matchingCredential.id),
      );
      assertCredentialRecord(result.data);

      if (result.data.origin !== origin || result.data.username !== username) {
        return null;
      }

      return {
        id: matchingCredential.id,
        credential: result.data,
        version: result.metadata?.version,
      };
    } catch {
      return null;
    }
  }
}

// A missing or malformed entry is skipped, but an expired/denied token must
// surface: silently returning "no credentials" hides the need to re-login.
function rethrowAuthError(error: unknown): void {
  if (
    error instanceof VaultClientError &&
    (error.status === 401 || error.status === 403)
  ) {
    throw error;
  }
}

function toSummary(
  id: string,
  credential: CredentialRecord,
): CredentialSummary {
  return {
    id,
    origin: credential.origin,
    username: credential.username,
    url: credential.url,
    title: credential.title,
    updated_at: credential.updated_at,
  };
}
