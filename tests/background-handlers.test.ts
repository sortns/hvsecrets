import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidateCredentialIndex } from "../src/background/credential-index";
import { handleRuntimeRequest } from "../src/background/handlers";
import { configStorageKey, secretsStorageKey } from "../src/shared/config";
import type { ExtensionStorageArea } from "../src/background/storage";

describe("background request handlers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    invalidateCredentialIndex();
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

  it("returns a graceful error instead of throwing when searching credentials without a configured token", async () => {
    const response = await handleRuntimeRequest(
      { type: "credentials.search", query: "" },
      createMemoryStorage(),
      createTabsApi({}),
    );

    expect(response).toEqual({
      type: "credentials.searchResult",
      credentials: [],
      error: "Vault token is not configured",
    });
  });

  it("returns a graceful error instead of throwing when revealing a credential without a configured token", async () => {
    const response = await handleRuntimeRequest(
      {
        type: "credentials.reveal",
        origin: "https://example.com",
        credentialId: "11111111-1111-1111-1111-111111111111",
      },
      createMemoryStorage(),
      createTabsApi({}),
    );

    expect(response).toEqual({
      type: "credentials.revealResult",
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
        approleAuthMount: "approle",
        approleRoleId: "",
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

  it("runs the Vault AppRole login flow and stores the returned token", async () => {
    const storage = createMemoryStorage({
      [configStorageKey]: {
        vaultUrl: "http://vault.example",
        kvMount: "secret",
        basePath: "hvsecrets",
        authMode: "approle",
        oidcAuthMount: "oidc",
        oidcRole: "hvsecrets",
        approleAuthMount: "approle",
        approleRoleId: "role-id",
        vaultNamespace: "",
      },
      [secretsStorageKey]: {
        approleSecretId: "secret-id",
      },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        auth: {
          client_token: "approle-token",
          lease_duration: 3600,
          renewable: true,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const response = await handleRuntimeRequest(
      { type: "auth.loginApprole" },
      storage,
      createTabsApi({}),
    );

    expect(response).toEqual(
      expect.objectContaining({
        type: "auth.approleLoginResult",
        ok: true,
        renewable: true,
      }),
    );
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://vault.example/v1/auth/approle/login",
    );
    const storedSecrets = (await storage.get(secretsStorageKey))[
      secretsStorageKey
    ] as Record<string, unknown> | undefined;
    expect(storedSecrets).toEqual(
      expect.objectContaining({
        vaultToken: "approle-token",
        tokenRenewable: true,
        approleSecretId: "secret-id",
      }),
    );
  });

  it("returns an actionable error when AppRole login is missing a secret ID", async () => {
    const storage = createMemoryStorage({
      [configStorageKey]: {
        vaultUrl: "http://vault.example",
        kvMount: "secret",
        basePath: "hvsecrets",
        authMode: "approle",
        oidcAuthMount: "oidc",
        oidcRole: "hvsecrets",
        approleAuthMount: "approle",
        approleRoleId: "role-id",
        vaultNamespace: "",
      },
    });

    const response = await handleRuntimeRequest(
      { type: "auth.loginApprole" },
      storage,
      createTabsApi({}),
    );

    expect(response).toEqual({
      type: "auth.approleLoginResult",
      ok: false,
      error: "AppRole secret ID is required",
    });
  });

  it("reports an expired-session error instead of hanging when saving a pending credential fails with 403", async () => {
    const storage = createMemoryStorage({
      [configStorageKey]: {
        vaultUrl: "http://vault.example",
        kvMount: "secret",
        basePath: "hvsecrets",
        authMode: "oidc",
        oidcAuthMount: "oidc",
        oidcRole: "hvsecrets",
        approleAuthMount: "approle",
        approleRoleId: "",
        vaultNamespace: "",
      },
      [secretsStorageKey]: {
        vaultToken: "expired-token",
      },
    });
    const sender = { tab: { url: "https://example.com/login" } };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { keys: [] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { keys: [] } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: ["permission denied"] }), {
          status: 403,
        }),
      );
    vi.stubGlobal("fetch", fetchImpl);

    const captureResponse = await handleRuntimeRequest(
      {
        type: "credentials.captureLoginAttempt",
        credential: {
          url: "https://example.com/login",
          title: "Example",
          username: "alice",
          password: "hunter2",
        },
      },
      storage,
      createTabsApi({}),
      sender,
    );
    expect(captureResponse).toEqual({
      type: "credentials.captureResult",
      ok: true,
    });

    const saveResponse = await handleRuntimeRequest(
      { type: "credentials.savePendingForSenderOrigin" },
      storage,
      createTabsApi({}),
      sender,
    );

    expect(saveResponse).toEqual({
      type: "credentials.saveResult",
      ok: false,
      error: "Vault session expired. Please log in again.",
    });
  });
  it("serves repeated searches from the cached index and reloads on refresh", async () => {
    const vault = createFakeVault({
      "https.example.com": {
        "11111111-1111-1111-1111-111111111111": credentialData(
          "https://example.com",
          "alice",
        ),
      },
    });
    vi.stubGlobal("fetch", vault.fetch);
    const storage = createConfiguredStorage();

    const first = await handleRuntimeRequest(
      { type: "credentials.search", query: "" },
      storage,
      createTabsApi({}),
    );
    const requestsAfterFirst = vault.fetch.mock.calls.length;
    const second = await handleRuntimeRequest(
      { type: "credentials.search", query: "alice" },
      storage,
      createTabsApi({}),
    );

    expect(first).toEqual(
      expect.objectContaining({
        credentials: [expect.objectContaining({ username: "alice" })],
      }),
    );
    expect(second).toEqual(first);
    expect(vault.fetch.mock.calls.length).toBe(requestsAfterFirst);

    await handleRuntimeRequest(
      { type: "credentials.search", query: "", refresh: true },
      storage,
      createTabsApi({}),
    );
    expect(vault.fetch.mock.calls.length).toBeGreaterThan(requestsAfterFirst);
  });

  it("deletes a credential and drops it from the cached search index", async () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const vault = createFakeVault({
      "https.example.com": {
        [id]: credentialData("https://example.com", "alice"),
      },
    });
    vi.stubGlobal("fetch", vault.fetch);
    const storage = createConfiguredStorage();

    await handleRuntimeRequest(
      { type: "credentials.search", query: "" },
      storage,
      createTabsApi({}),
    );
    const deleteResponse = await handleRuntimeRequest(
      {
        type: "credentials.delete",
        origin: "https://example.com",
        credentialId: id,
      },
      storage,
      createTabsApi({}),
    );
    const searchResponse = await handleRuntimeRequest(
      { type: "credentials.search", query: "" },
      storage,
      createTabsApi({}),
    );

    expect(deleteResponse).toEqual({
      type: "credentials.deleteResult",
      ok: true,
    });
    expect(vault.fetch).toHaveBeenCalledWith(
      `http://vault.example/v1/secret/metadata/hvsecrets/credentials/https.example.com/${id}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(searchResponse).toEqual({
      type: "credentials.searchResult",
      credentials: [],
    });
  });

  it("reports an expired session when listing site credentials gets 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ errors: ["permission denied"] }), {
          status: 403,
        }),
      ),
    );

    const response = await handleRuntimeRequest(
      { type: "credentials.listForCurrentTab" },
      createConfiguredStorage(),
      createTabsApi({ id: 1, url: "https://example.com/login" }),
    );

    expect(response).toEqual({
      type: "credentials.list",
      origin: "https://example.com",
      credentials: [],
      error: "Vault session expired. Please log in again.",
    });
  });

  it("sends a generated password to the page and relays the page's answer", async () => {
    const sendMessage = vi
      .fn<(tabId: number, message: unknown) => Promise<unknown>>()
      .mockResolvedValue({ ok: false, error: "No field" });

    const response = await handleRuntimeRequest(
      { type: "credentials.fillGeneratedPassword", password: "Gen3rated!" },
      createMemoryStorage(),
      {
        query: () =>
          Promise.resolve([{ id: 7, url: "https://example.com/signup" }]),
        sendMessage,
      },
    );

    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: "content.fillPassword",
      password: "Gen3rated!",
    });
    expect(response).toEqual({
      type: "credentials.fillResult",
      ok: false,
      error: "No field",
    });
  });
  it("remembers the username step per tab and clears it once the password is captured", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 404 })),
    );
    const sessionStorage = createMemoryStorage();
    const sender = { tab: { id: 9, url: "https://accounts.example/signin" } };
    const otherTab = {
      tab: { id: 10, url: "https://accounts.example/signin" },
    };

    await handleRuntimeRequest(
      {
        type: "credentials.rememberLoginStep",
        username: " alice@example.com ",
      },
      createConfiguredStorage(),
      createTabsApi({}),
      sender,
      undefined,
      sessionStorage,
    );

    await expect(
      handleRuntimeRequest(
        { type: "credentials.loginStepForSenderOrigin" },
        createConfiguredStorage(),
        createTabsApi({}),
        sender,
        undefined,
        sessionStorage,
      ),
    ).resolves.toEqual({
      type: "credentials.loginStep",
      username: "alice@example.com",
    });
    await expect(
      handleRuntimeRequest(
        { type: "credentials.loginStepForSenderOrigin" },
        createConfiguredStorage(),
        createTabsApi({}),
        otherTab,
        undefined,
        sessionStorage,
      ),
    ).resolves.toEqual({ type: "credentials.loginStep", username: null });

    await handleRuntimeRequest(
      {
        type: "credentials.captureLoginAttempt",
        credential: {
          url: "https://accounts.example/signin/pwd",
          title: "Sign in",
          username: "alice@example.com",
          password: "hunter2",
        },
      },
      createConfiguredStorage(),
      createTabsApi({}),
      sender,
      undefined,
      sessionStorage,
    );

    await expect(
      handleRuntimeRequest(
        { type: "credentials.loginStepForSenderOrigin" },
        createConfiguredStorage(),
        createTabsApi({}),
        sender,
        undefined,
        sessionStorage,
      ),
    ).resolves.toEqual({ type: "credentials.loginStep", username: null });
  });
});

function createConfiguredStorage(): ExtensionStorageArea {
  return createMemoryStorage({
    [configStorageKey]: {
      vaultUrl: "http://vault.example",
      kvMount: "secret",
      basePath: "hvsecrets",
      authMode: "token",
      oidcAuthMount: "oidc",
      oidcRole: "hvsecrets",
      approleAuthMount: "approle",
      approleRoleId: "",
      vaultNamespace: "",
    },
    [secretsStorageKey]: { vaultToken: "token" },
  });
}

function credentialData(origin: string, username: string) {
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

// Minimal KV v2 server: LIST/GET/DELETE under secret/{metadata,data}/hvsecrets.
function createFakeVault(
  tree: Record<string, Record<string, Record<string, unknown>>>,
) {
  const prefix = "http://vault.example/v1/secret/";
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? "GET";
    const [kind, ...rest] = url.slice(prefix.length).split("/");
    const segments = rest.slice(2);
    const notFound = new Response(JSON.stringify({ errors: [] }), {
      status: 404,
    });

    if (method === "LIST" && kind === "metadata") {
      const keys =
        segments.length === 0
          ? Object.keys(tree).map((origin) => `${origin}/`)
          : Object.keys(tree[segments[0]] ?? {});

      return Promise.resolve(
        keys.length === 0 ? notFound : jsonResponse({ data: { keys } }),
      );
    }

    const [origin = "", id = ""] = segments;
    const records = Object.hasOwn(tree, origin) ? tree[origin] : {};

    if (!Object.hasOwn(records, id)) {
      return Promise.resolve(notFound);
    }

    if (method === "DELETE" && kind === "metadata") {
      Reflect.deleteProperty(records, id);
      if (Object.keys(records).length === 0) {
        Reflect.deleteProperty(tree, origin);
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    return Promise.resolve(
      jsonResponse({ data: { data: records[id], metadata: { version: 1 } } }),
    );
  });

  return { fetch };
}

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
