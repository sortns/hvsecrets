import { describe, expect, it, vi } from "vitest";
import { VaultAppRoleClient } from "../src/vault/approle-client";

interface FetchRequestInit {
  readonly method?: string;
  readonly body?: string;
}

describe("VaultAppRoleClient", () => {
  it("logs in with role ID and secret ID and returns Vault token metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        auth: {
          client_token: "approle-token",
          lease_duration: 3600,
          renewable: true,
        },
      }),
    );
    const client = new VaultAppRoleClient({
      vaultUrl: "http://vault.example",
      authMount: "approle",
      fetchImpl,
    });

    await expect(
      client.login({ roleId: "role-id", secretId: "secret-id" }),
    ).resolves.toEqual({
      clientToken: "approle-token",
      leaseDuration: 3600,
      renewable: true,
    });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://vault.example/v1/auth/approle/login",
    );
    const init = fetchImpl.mock.calls[0]?.[1] as FetchRequestInit | undefined;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ role_id: "role-id", secret_id: "secret-id" }),
    );
  });

  it("throws when the login response does not include a client token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
    const client = new VaultAppRoleClient({
      vaultUrl: "http://vault.example",
      authMount: "approle",
      fetchImpl,
    });

    await expect(
      client.login({ roleId: "role-id", secretId: "secret-id" }),
    ).rejects.toThrow(
      "Vault AppRole login response did not include client token",
    );
  });

  it("throws a VaultClientError when Vault rejects the secret ID", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ errors: ["invalid secret id"] }), {
        status: 400,
      }),
    );
    const client = new VaultAppRoleClient({
      vaultUrl: "http://vault.example",
      authMount: "approle",
      fetchImpl,
    });

    await expect(
      client.login({ roleId: "role-id", secretId: "bad-secret" }),
    ).rejects.toThrow("Vault request failed with status 400");
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
    },
  });
}
