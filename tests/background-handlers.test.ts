import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRuntimeRequest } from "../src/background/handlers";
import { configStorageKey, secretsStorageKey } from "../src/shared/config";
import type { ExtensionStorageArea } from "../src/background/storage";

describe("background request handlers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns config state with validation errors when token is missing", async () => {
    const response = await handleRuntimeRequest(
      { type: "config.get" },
      createMemoryStorage(),
      createTabsApi({}),
    );

    expect(response.type).toBe("config.state");
    if (response.type === "config.state") {
      expect(response.validation.ok).toBe(false);
      expect(response.validation.errors).toContain(
        "Vault token is required for token auth",
      );
    }
  });

  it("rejects token validation when no token is configured", async () => {
    const response = await handleRuntimeRequest(
      { type: "auth.validateToken" },
      createMemoryStorage(),
      createTabsApi({}),
    );

    expect(response).toEqual({
      type: "auth.validationResult",
      ok: false,
      error: "Vault token is not configured",
    });
  });

  it("returns an actionable error when OIDC login has no browser tab flow", async () => {
    const response = await handleRuntimeRequest(
      { type: "auth.loginOidc" },
      createMemoryStorage(),
      createTabsApi({}),
    );

    expect(response).toEqual({
      type: "auth.oidcLoginResult",
      ok: false,
      error: "OIDC browser tab flow is not available",
    });
  });

  it("returns a current-tab URL error for non-page URLs", async () => {
    const response = await handleRuntimeRequest(
      { type: "credentials.listForCurrentTab" },
      createMemoryStorage(),
      createTabsApi({ url: "about:config" }),
    );

    expect(response).toEqual({
      type: "credentials.list",
      origin: null,
      credentials: [],
      error: "Current tab does not have a fillable URL",
    });
  });

  it("runs the Vault OIDC login flow and stores the returned token", async () => {
    const storage = createMemoryStorage({
      [configStorageKey]: {
        vaultUrl: "http://vault.example",
        kvMount: "secret",
        basePath: "hvsecrets",
        authMode: "oidc",
        oidcAuthMount: "oidc",
        oidcRole: "hvsecrets",
        vaultNamespace: "",
      },
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            auth_url:
              "https://idp.example/authorize?nonce=vault-nonce&state=vault-state",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          auth: {
            client_token: "oidc-token",
            lease_duration: 3600,
            renewable: true,
          },
        }),
      );
    vi.stubGlobal("fetch", fetchImpl);

    const response = await handleRuntimeRequest(
      { type: "auth.loginOidc" },
      storage,
      createTabsApi({}),
      {},
      {
        openAuthUrlAndWaitForCallback: (_authUrl, callbackUrlPrefix) =>
          Promise.resolve(`${callbackUrlPrefix}?code=code&state=state`),
      },
    );

    expect(response).toEqual(
      expect.objectContaining({
        type: "auth.oidcLoginResult",
        ok: true,
        renewable: true,
        redirectUri: "http://localhost:8250/oidc/callback",
      }),
    );
    const storedSecrets = (await storage.get(secretsStorageKey))[
      secretsStorageKey
    ] as Record<string, unknown> | undefined;
    expect(storedSecrets).toEqual(
      expect.objectContaining({
        vaultToken: "oidc-token",
        tokenRenewable: true,
      }),
    );
  });
});

function createTabsApi(tab: {
  readonly url?: string;
  readonly id?: number;
  readonly title?: string;
}) {
  return {
    query() {
      return Promise.resolve([tab]);
    },
    sendMessage() {
      return Promise.resolve(undefined);
    },
  };
}

function createMemoryStorage(
  initial: Record<string, unknown> = {},
): ExtensionStorageArea {
  const values = { ...initial };

  return {
    get(keys?: string | string[] | Record<string, unknown> | null) {
      if (typeof keys === "string") {
        return Promise.resolve({ [keys]: values[keys] });
      }

      if (Array.isArray(keys)) {
        return Promise.resolve(
          Object.fromEntries(keys.map((key) => [key, values[key]])),
        );
      }

      if (keys !== null && typeof keys === "object") {
        return Promise.resolve(
          Object.fromEntries(
            Object.entries(keys).map(([key, defaultValue]) => [
              key,
              values[key] ?? defaultValue,
            ]),
          ),
        );
      }

      return Promise.resolve({ ...values });
    },
    set(items: Record<string, unknown>) {
      Object.assign(values, items);
      return Promise.resolve();
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}
