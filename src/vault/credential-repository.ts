import { randomId } from "../shared/random";
import { normalizeOrigin, originPathSegment } from "../shared/origin";
import {
  assertCredentialRecord,
  createCredentialRecord,
  updateCredentialRecord,
  type CredentialRecord,
  type NewCredentialRecordInput,
} from "./credential";
import { joinVaultPath } from "./paths";

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
    const basePath = this.originCredentialsPath(origin);
    let keys: readonly string[];

    try {
      keys = await this.client.list(basePath);
    } catch {
      return [];
    }

    const credentialIds = keys.filter((key) => !key.endsWith("/"));
    const credentials = await Promise.all(
      credentialIds.map(async (id): Promise<CredentialSummary | null> => {
        try {
          const result = await this.client.read(
            this.credentialPath(origin, id),
          );
          assertCredentialRecord(result.data);

          return toSummary(id, result.data);
        } catch {
          return null;
        }
      }),
    );

    return credentials.filter((credential) => credential !== null);
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
    } catch {
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
