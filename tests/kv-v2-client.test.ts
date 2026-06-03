import { describe, expect, it, vi } from "vitest";
import { VaultClientError } from "../src/vault/errors";
import { VaultKvV2Client } from "../src/vault/kv-v2-client";

describe("VaultKvV2Client", () => {
  it("uses KV v2 data and metadata paths", () => {
    const client = new VaultKvV2Client({
      vaultUrl: "http://127.0.0.1:8200",
      token: "dev-token",
      mount: "secret",
    });

    expect(client.dataPath("hvsecrets/credentials/example.com/id")).toBe(
      "secret/data/hvsecrets/credentials/example.com/id",
    );
    expect(client.metadataPath("hvsecrets/credentials/example.com")).toBe(
      "secret/metadata/hvsecrets/credentials/example.com",
    );
  });

  it("reads a KV v2 secret", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          data: { username: "alice" },
          metadata: { version: 3 },
        },
      }),
    );
    const client = createClient(fetchImpl);

    await expect(
      client.read("hvsecrets/credentials/example.com/id"),
    ).resolves.toEqual({
      data: { username: "alice" },
      metadata: { version: 3 },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://vault.example/v1/secret/data/hvsecrets/credentials/example.com/id",
      expect.objectContaining({
        method: "GET",
        body: undefined,
      }),
    );
  });

  it("writes a KV v2 secret with CAS", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: { version: 4 },
      }),
    );
    const client = createClient(fetchImpl);

    await expect(
      client.write(
        "hvsecrets/credentials/example.com/id",
        { username: "alice" },
        { cas: 3 },
      ),
    ).resolves.toEqual({ version: 4 });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ data: { username: "alice" }, options: { cas: 3 } }),
    );
  });

  it("lists KV v2 metadata keys", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: { keys: ["one", "two/"] },
      }),
    );
    const client = createClient(fetchImpl);

    await expect(
      client.list("hvsecrets/credentials/example.com"),
    ).resolves.toEqual(["one", "two/"]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://vault.example/v1/secret/metadata/hvsecrets/credentials/example.com",
      expect.objectContaining({ method: "LIST" }),
    );
  });

  it("deletes a KV v2 secret", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = createClient(fetchImpl);

    await expect(
      client.delete("hvsecrets/credentials/example.com/id"),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://vault.example/v1/secret/data/hvsecrets/credentials/example.com/id",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("validates a token with lookup-self", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          display_name: "token",
          ttl: 3600,
          renewable: true,
        },
      }),
    );
    const client = createClient(fetchImpl);

    await expect(client.lookupSelf()).resolves.toEqual({
      display_name: "token",
      ttl: 3600,
      renewable: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://vault.example/v1/auth/token/lookup-self",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws typed errors without exposing the token", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ errors: ["permission denied"] }, { status: 403 }),
      );
    const client = createClient(fetchImpl);

    await expect(
      client.read("hvsecrets/credentials/example.com/id"),
    ).rejects.toMatchObject({
      name: "VaultClientError",
      status: 403,
      errors: ["permission denied"],
    } satisfies Partial<VaultClientError>);
    await expect(
      client.read("hvsecrets/credentials/example.com/id"),
    ).rejects.not.toThrow("dev-token");
  });
});

function createClient(fetchImpl: typeof fetch): VaultKvV2Client {
  return new VaultKvV2Client({
    vaultUrl: "http://vault.example/",
    token: "dev-token",
    mount: "secret",
    fetchImpl,
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
    },
  });
}
