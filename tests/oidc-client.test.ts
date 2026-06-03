import { describe, expect, it, vi } from "vitest";
import { VaultOidcClient } from "../src/vault/oidc-client";

interface FetchRequestInit {
  readonly method?: string;
  readonly body?: string;
}

describe("VaultOidcClient", () => {
  it("creates an OIDC auth URL and keeps nonce metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          auth_url:
            "https://idp.example/authorize?code=ignored&nonce=vault-nonce&state=vault-state",
        },
      }),
    );
    const client = new VaultOidcClient({
      vaultUrl: "http://vault.example",
      authMount: "oidc",
      fetchImpl,
    });

    const result = await client.createAuthUrl({
      role: "hvsecrets",
      redirectUri: "https://extension.example/callback",
    });

    expect(result.authUrl).toContain("https://idp.example/authorize");
    expect(result.nonce).toBe("vault-nonce");
    expect(result.clientNonce).toEqual(expect.any(String));
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://vault.example/v1/auth/oidc/oidc/auth_url",
    );
    const init = fetchImpl.mock.calls[0]?.[1] as FetchRequestInit | undefined;
    expect(init?.method).toBe("POST");
    expect(init?.body).toContain('"role":"hvsecrets"');
  });

  it("resolves relative Vault OIDC auth URLs against the configured Vault URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          auth_url:
            "/ui/vault/auth/oidc/oidc/callback?nonce=vault-nonce&state=vault-state",
        },
      }),
    );
    const client = new VaultOidcClient({
      vaultUrl: "https://vault.example",
      authMount: "oidc",
      fetchImpl,
    });

    const result = await client.createAuthUrl({
      role: "hvsecrets",
      redirectUri: "https://extension.example/callback",
    });

    expect(result.authUrl).toBe(
      "https://vault.example/ui/vault/auth/oidc/oidc/callback?nonce=vault-nonce&state=vault-state",
    );
    expect(result.nonce).toBe("vault-nonce");
  });

  it("accepts HTML-escaped query separators in Vault OIDC auth URLs", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          auth_url:
            "https://idp.example/authorize?client_id=vault&amp;nonce=vault-nonce&amp;state=vault-state",
        },
      }),
    );
    const client = new VaultOidcClient({
      vaultUrl: "https://vault.example",
      authMount: "oidc",
      fetchImpl,
    });

    const result = await client.createAuthUrl({
      role: "hvsecrets",
      redirectUri: "https://extension.example/callback",
    });

    expect(result.authUrl).toBe(
      "https://idp.example/authorize?client_id=vault&nonce=vault-nonce&state=vault-state",
    );
    expect(result.nonce).toBe("vault-nonce");
  });

  it("includes a redacted returned auth URL when nonce is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: {
          auth_url:
            "https://vault.example/ui/vault/auth/oidc/oidc/callback?code=secret-code",
        },
      }),
    );
    const client = new VaultOidcClient({
      vaultUrl: "https://vault.example",
      authMount: "oidc",
      fetchImpl,
    });

    await expect(
      client.createAuthUrl({
        role: "hvsecrets",
        redirectUri: "https://extension.example/callback",
      }),
    ).rejects.toThrow(
      "Vault OIDC auth_url response did not include nonce. Returned URL: https://vault.example/ui/vault/auth/oidc/oidc/callback?code=redacted",
    );
  });

  it("completes callback and returns Vault token metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        auth: {
          client_token: "vault-token",
          lease_duration: 3600,
          renewable: true,
        },
      }),
    );
    const client = new VaultOidcClient({
      vaultUrl: "http://vault.example",
      authMount: "oidc",
      fetchImpl,
    });

    await expect(
      client.completeCallback({
        code: "code",
        state: "state",
        nonce: "nonce",
        clientNonce: "client-nonce",
      }),
    ).resolves.toEqual({
      clientToken: "vault-token",
      leaseDuration: 3600,
      renewable: true,
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toContain(
      "/v1/auth/oidc/oidc/callback?",
    );
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
