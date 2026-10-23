import { describe, expect, it } from "vitest";
import {
  CredentialRepository,
  type CredentialKvClient,
} from "../src/vault/credential-repository";
import { VaultClientError } from "../src/vault/errors";

describe("CredentialRepository", () => {
  it("saves credentials under per-origin KV v2 paths", async () => {
    const client = createFakeClient();
    const repository = new CredentialRepository(client, "hvsecrets");
    const saved = await repository.save({
      origin: "https://example.com/login",
      username: "alice",
      password: "secret",
      url: "https://example.com/login",
      title: "Example",
    });

    expect(saved.username).toBe("alice");
    expect(client.writes[0]?.path).toMatch(
      /^hvsecrets\/credentials\/https\.example\.com\/[0-9a-f-]+$/,
    );
    expect(client.writes[0]?.options).toEqual({ cas: 0 });
  });

  it("lists credential summaries without passwords", async () => {
    const client = createFakeClient({
      "hvsecrets/credentials/https.example.com/id-1": {
        schema: 1,
        origin: "https://example.com",
        realm: null,
        username: "alice",
        password: "secret",
        url: "https://example.com/login",
        title: "Example",
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        tags: [],
        notes: "",
      },
    });
    const repository = new CredentialRepository(client, "hvsecrets");

    await expect(
      repository.listForOrigin("https://example.com/login"),
    ).resolves.toEqual([
      {
        id: "id-1",
        origin: "https://example.com",
        username: "alice",
        url: "https://example.com/login",
        title: "Example",
        updated_at: "2026-05-26T00:00:00.000Z",
      },
    ]);
  });

  it("updates an existing username instead of creating a duplicate secret", async () => {
    const client = createFakeClient({
      "hvsecrets/credentials/https.example.com/id-1": {
        schema: 1,
        origin: "https://example.com",
        realm: null,
        username: "alice",
        password: "old-secret",
        url: "https://example.com/login",
        title: "Example",
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        tags: [],
        notes: "",
      },
    });
    const repository = new CredentialRepository(client, "hvsecrets");

    const saved = await repository.saveOrUpdate({
      origin: "https://example.com/login",
      username: "alice",
      password: "new-secret",
      url: "https://example.com/login",
      title: "Example",
    });

    expect(saved.id).toBe("id-1");
    expect(client.writes).toHaveLength(1);
    expect(client.writes[0]?.path).toBe(
      "hvsecrets/credentials/https.example.com/id-1",
    );
    expect(client.writes[0]?.options).toEqual({ cas: 1 });
    expect(client.writes[0]?.data).toEqual(
      expect.objectContaining({
        username: "alice",
        password: "new-secret",
        created_at: "2026-05-26T00:00:00.000Z",
      }),
    );
  });

  it("searches credentials across every origin", async () => {
    const client = createFakeClient({
      "hvsecrets/credentials/https.example.com/id-1": {
        schema: 1,
        origin: "https://example.com",
        realm: null,
        username: "alice",
        password: "secret",
        url: "https://example.com/login",
        title: "Example",
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        tags: [],
        notes: "",
      },
      "hvsecrets/credentials/https.other.example/id-2": {
        schema: 1,
        origin: "https://other.example",
        realm: null,
        username: "bob",
        password: "secret2",
        url: "https://other.example/login",
        title: "Other",
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        tags: [],
        notes: "",
      },
    });
    const repository = new CredentialRepository(client, "hvsecrets");

    const results = await repository.searchAll();

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "id-1", origin: "https://example.com" }),
        expect.objectContaining({
          id: "id-2",
          origin: "https://other.example",
        }),
      ]),
    );
    expect(results).toHaveLength(2);
  });

  it("returns an empty search result when the credentials root does not exist yet", async () => {
    const client = createFakeClient();
    const repository = new CredentialRepository(client, "hvsecrets");

    await expect(repository.searchAll()).resolves.toEqual([]);
  });

  it("permanently deletes a credential that belongs to the origin", async () => {
    const client = createFakeClient({
      "hvsecrets/credentials/https.example.com/id-1": credentialRecord(
        "https://example.com",
        "alice",
      ),
    });
    const repository = new CredentialRepository(client, "hvsecrets");

    await expect(
      repository.delete("https://example.com/login", "id-1"),
    ).resolves.toBe(true);
    expect(client.deletedMetadata).toEqual([
      "hvsecrets/credentials/https.example.com/id-1",
    ]);
    await expect(
      repository.listForOrigin("https://example.com"),
    ).resolves.toEqual([]);
  });

  it("refuses to delete a credential through a different origin", async () => {
    const client = createFakeClient({
      "hvsecrets/credentials/https.example.com/id-1": credentialRecord(
        "https://other.example",
        "alice",
      ),
    });
    const repository = new CredentialRepository(client, "hvsecrets");

    await expect(
      repository.delete("https://example.com", "id-1"),
    ).resolves.toBe(false);
    expect(client.deletedMetadata).toEqual([]);
  });

  it("surfaces an expired Vault session instead of reporting no credentials", async () => {
    const client = createFakeClient();
    client.list = () =>
      Promise.reject(new VaultClientError("Vault request failed", 403));
    const repository = new CredentialRepository(client, "hvsecrets");

    await expect(
      repository.listForOrigin("https://example.com"),
    ).rejects.toBeInstanceOf(VaultClientError);
    await expect(repository.searchAll()).rejects.toBeInstanceOf(
      VaultClientError,
    );
  });

  it("searches many origins with bounded concurrency", async () => {
    const records: Record<string, Record<string, unknown>> = {};

    for (let index = 0; index < 60; index += 1) {
      records[
        `hvsecrets/credentials/https.site${String(index)}.example/id-${String(index)}`
      ] = credentialRecord(`https://site${String(index)}.example`, "alice");
    }

    const client = createFakeClient(records);
    const read = client.read.bind(client);
    let inFlight = 0;
    let maxInFlight = 0;
    client.read = async (path: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;

      return read(path);
    };
    const repository = new CredentialRepository(client, "hvsecrets");

    await expect(repository.searchAll()).resolves.toHaveLength(60);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(16);
  });

  it("detects exact credentials for an origin and username", async () => {
    const client = createFakeClient({
      "hvsecrets/credentials/https.example.com/id-1": {
        schema: 1,
        origin: "https://example.com",
        realm: null,
        username: "alice",
        password: "secret",
        url: "https://example.com/login",
        title: "Example",
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
        tags: [],
        notes: "",
      },
    });
    const repository = new CredentialRepository(client, "hvsecrets");

    await expect(
      repository.hasExactCredential({
        origin: "https://example.com/login",
        username: "alice",
        password: "secret",
        url: "https://example.com/login",
        title: "Example",
      }),
    ).resolves.toBe(true);
    await expect(
      repository.hasExactCredential({
        origin: "https://example.com/login",
        username: "alice",
        password: "different",
        url: "https://example.com/login",
        title: "Example",
      }),
    ).resolves.toBe(false);
  });
});

interface FakeClient {
  readonly deletedMetadata: string[];
  readonly writes: {
    readonly path: string;
    readonly data: Record<string, unknown>;
    readonly options?: { readonly cas?: number };
  }[];
}

function createFakeClient(
  records: Record<string, Record<string, unknown>> = {},
): FakeClient & {
  -readonly [Key in keyof CredentialKvClient]: CredentialKvClient[Key];
} {
  const writes: FakeClient["writes"] = [];
  const deletedMetadata: string[] = [];
  const fakeClient = {
    writes,
    deletedMetadata,
    deleteMetadata(path: string) {
      deletedMetadata.push(path);
      Reflect.deleteProperty(records, path);

      return Promise.resolve();
    },
    write(
      path: string,
      data: Record<string, unknown>,
      options?: { readonly cas?: number },
    ) {
      writes.push({ path, data, options });
      records[path] = data;

      return Promise.resolve({ version: 1 });
    },
    list(path: string) {
      const prefix = `${path}/`;
      const immediateKeys = new Set<string>();

      for (const recordPath of Object.keys(records)) {
        if (!recordPath.startsWith(prefix)) {
          continue;
        }

        const rest = recordPath.slice(prefix.length);
        const slashIndex = rest.indexOf("/");

        immediateKeys.add(
          slashIndex === -1 ? rest : `${rest.slice(0, slashIndex)}/`,
        );
      }

      return Promise.resolve([...immediateKeys]);
    },
    read(path: string) {
      const data = records[path];

      if (!Object.hasOwn(records, path)) {
        return Promise.reject(new Error("not found"));
      }

      return Promise.resolve({
        data,
        metadata: { version: 1 },
      });
    },
  };

  return fakeClient;
}

function credentialRecord(
  origin: string,
  username: string,
): Record<string, unknown> {
  return {
    schema: 1,
    origin,
    realm: null,
    username,
    password: "secret",
    url: `${origin}/login`,
    title: "Example",
    created_at: "2026-05-26T00:00:00.000Z",
    updated_at: "2026-05-26T00:00:00.000Z",
    tags: [],
    notes: "",
  };
}
