import { describe, expect, it } from "vitest";
import {
  configStorageKey,
  defaultConfig,
  secretsStorageKey,
} from "../src/shared/config";
import {
  addIgnoredOrigin,
  getConfig,
  ignoredOriginsStorageKey,
  isIgnoredOrigin,
  listIgnoredOrigins,
  getSecrets,
  removeIgnoredOrigin,
  saveVaultToken,
  saveConfig,
  type ExtensionStorageArea,
} from "../src/background/storage";

describe("background config storage", () => {
  it("returns defaults without exposing secrets", async () => {
    const storage = createMemoryStorage();
    const config = await getConfig(storage);

    expect(config.vaultUrl).toBe(defaultConfig.vaultUrl);
    expect(config.kvMount).toBe(defaultConfig.kvMount);
    expect(config.hasToken).toBe(false);
  });

  it("keeps a config saved before AppRole support instead of resetting it to defaults", async () => {
    const storage = createMemoryStorage({
      [configStorageKey]: {
        vaultUrl: "https://vault.example",
        kvMount: "secret",
        basePath: "hvsecrets",
        authMode: "oidc",
        oidcAuthMount: "oidc",
        oidcRole: "hvsecrets",
        vaultNamespace: "",
      },
      [secretsStorageKey]: {
        vaultToken: "old-token",
      },
    });

    const config = await getConfig(storage);

    expect(config.vaultUrl).toBe("https://vault.example");
    expect(config.authMode).toBe("oidc");
    expect(config.hasToken).toBe(true);
    expect(config.approleAuthMount).toBe(defaultConfig.approleAuthMount);
    expect(config.approleRoleId).toBe(defaultConfig.approleRoleId);
  });

  it("saves normalized config and token presence separately", async () => {
    const storage = createMemoryStorage();
    const config = await saveConfig(storage, {
      config: {
        vaultUrl: "http://vault.example:8200/",
        kvMount: "/secret/",
        basePath: "/hvsecrets/",
        authMode: "token",
        oidcAuthMount: "oidc",
        oidcRole: "hvsecrets",
        vaultNamespace: "admin",
      },
      vaultToken: " dev-token ",
    });

    expect(config).toEqual(
      expect.objectContaining({
        vaultUrl: "http://vault.example:8200",
        kvMount: "secret",
        basePath: "hvsecrets",
        hasToken: true,
      }),
    );
    await expect(getSecrets(storage)).resolves.toEqual({
      vaultToken: "dev-token",
      tokenExpiresAt: null,
      tokenRenewable: false,
    });
    expect(
      (await storage.get(configStorageKey))[configStorageKey],
    ).not.toHaveProperty("vaultToken");
  });

  it("can clear a previously saved token", async () => {
    const storage = createMemoryStorage({
      [secretsStorageKey]: { vaultToken: "dev-token" },
    });

    const config = await saveConfig(storage, {
      config: {
        vaultUrl: "http://vault.example:8200",
        kvMount: "secret",
        basePath: "hvsecrets",
        authMode: "token",
      },
      clearToken: true,
    });

    expect(config.hasToken).toBe(false);
    await expect(getSecrets(storage)).resolves.toEqual({});
  });

  it("stores OIDC token metadata", async () => {
    const storage = createMemoryStorage();

    await saveVaultToken(storage, {
      token: "oidc-token",
      leaseDuration: 3600,
      renewable: true,
    });

    const config = await getConfig(storage);

    expect(config.hasToken).toBe(true);
    expect(config.tokenExpiresAt).toEqual(expect.any(String));
    expect(config.tokenRenewable).toBe(true);
    await expect(getSecrets(storage)).resolves.toEqual(
      expect.objectContaining({
        vaultToken: "oidc-token",
        tokenRenewable: true,
      }),
    );
  });

  it("resets token metadata when a pasted token changes", async () => {
    const storage = createMemoryStorage({
      [secretsStorageKey]: {
        vaultToken: "old-token",
        tokenExpiresAt: "2026-01-01T00:00:00.000Z",
        tokenRenewable: true,
      },
    });

    await saveConfig(storage, {
      config: {
        vaultUrl: "http://vault.example:8200",
        kvMount: "secret",
        basePath: "hvsecrets",
        authMode: "token",
      },
      vaultToken: "new-token",
    });

    await expect(getSecrets(storage)).resolves.toEqual({
      vaultToken: "new-token",
      tokenExpiresAt: null,
      tokenRenewable: false,
    });
  });

  it("stores ignored origins normalized and sorted", async () => {
    const storage = createMemoryStorage();

    await addIgnoredOrigin(storage, "https://example.com/login");
    await addIgnoredOrigin(storage, "http://example.com/login");

    await expect(listIgnoredOrigins(storage)).resolves.toEqual([
      "http://example.com",
      "https://example.com",
    ]);
    await expect(
      isIgnoredOrigin(storage, "https://example.com/other"),
    ).resolves.toBe(true);
    await expect(
      isIgnoredOrigin(storage, "https://app.example.com"),
    ).resolves.toBe(false);
    expect(
      (await storage.get(ignoredOriginsStorageKey))[ignoredOriginsStorageKey],
    ).toEqual(["http://example.com", "https://example.com"]);
  });

  it("removes ignored origins", async () => {
    const storage = createMemoryStorage({
      [ignoredOriginsStorageKey]: ["https://example.com"],
    });

    await expect(
      removeIgnoredOrigin(storage, "https://example.com/path"),
    ).resolves.toEqual([]);
    await expect(isIgnoredOrigin(storage, "https://example.com")).resolves.toBe(
      false,
    );
  });
});

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
