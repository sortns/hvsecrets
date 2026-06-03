import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { VaultKvV2Client } from "../../src/vault/kv-v2-client";

const shouldRun = process.env.VAULT_INTEGRATION_TEST === "1";
const describeIntegration = shouldRun ? describe : describe.skip;

describeIntegration("Vault KV v2 integration", () => {
  it("validates token auth and performs KV v2 write/read/list/delete", async () => {
    const vaultUrl = requiredEnv("VAULT_ADDR", "VITE_VAULT_URL");
    const token = requiredEnv("VAULT_TOKEN");
    const mount =
      process.env.VAULT_KV_MOUNT ?? process.env.VITE_VAULT_KV_MOUNT ?? "secret";
    const basePath =
      process.env.VAULT_BASE_PATH ??
      process.env.VITE_VAULT_BASE_PATH ??
      "hvsecrets-test";
    const client = new VaultKvV2Client({ vaultUrl, token, mount });
    const credentialId = randomUUID();
    const path = `${basePath}/credentials/https.example.com/${credentialId}`;

    await expect(client.lookupSelf()).resolves.toEqual(
      expect.objectContaining({}),
    );
    const metadata = await client.write(path, {
      username: "alice",
      password: "secret",
    });

    expect(typeof metadata.version).toBe("number");
    await expect(client.read(path)).resolves.toMatchObject({
      data: { username: "alice", password: "secret" },
    });
    await expect(
      client.list(`${basePath}/credentials/https.example.com`),
    ).resolves.toContain(credentialId);
    await expect(client.delete(path)).resolves.toBeUndefined();
  });
});

function requiredEnv(primaryName: string, fallbackName?: string): string {
  const value =
    process.env[primaryName] ??
    (fallbackName === undefined ? undefined : process.env[fallbackName]);

  if (value === undefined || value.trim().length === 0) {
    const expectedNames =
      fallbackName === undefined
        ? primaryName
        : `${primaryName} or ${fallbackName}`;

    throw new Error(
      `${expectedNames} must be set when VAULT_INTEGRATION_TEST=1`,
    );
  }

  return value;
}
