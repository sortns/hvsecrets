import { describe, expect, it } from "vitest";
import {
  CredentialRepository,
  type CredentialKvClient,
} from "../src/vault/credential-repository";

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
  readonly writes: {
    readonly path: string;
    readonly data: Record<string, unknown>;
    readonly options?: { readonly cas?: number };
  }[];
}

function createFakeClient(
  records: Record<string, Record<string, unknown>> = {},
): FakeClient & CredentialKvClient {
  const writes: FakeClient["writes"] = [];
  const fakeClient = {
    writes,
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
      const keys = Object.keys(records)
        .filter((recordPath) => recordPath.startsWith(prefix))
        .map((recordPath) => recordPath.slice(prefix.length));

      return Promise.resolve(keys);
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
