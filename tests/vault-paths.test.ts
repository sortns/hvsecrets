import { describe, expect, it } from "vitest";
import { joinVaultPath, normalizeVaultPath, normalizeVaultUrl } from "../src/vault/paths";

describe("Vault path helpers", () => {
  it("normalizes safe paths", () => {
    expect(normalizeVaultPath("/firefox-vault/credentials/example.com/")).toBe(
      "firefox-vault/credentials/example.com"
    );
    expect(joinVaultPath("secret", "data", "firefox-vault")).toBe("secret/data/firefox-vault");
  });

  it("rejects traversal and unsafe segments", () => {
    expect(() => normalizeVaultPath("../secret")).toThrow("Invalid Vault path segment");
    expect(() => normalizeVaultPath("secret//value")).toThrow("Invalid Vault path segment");
    expect(() => normalizeVaultPath("secret/value?x=1")).toThrow("Invalid Vault path segment");
  });

  it("normalizes Vault URLs without preserving query or hash", () => {
    expect(normalizeVaultUrl("http://127.0.0.1:8200/?token=secret#hash")).toBe(
      "http://127.0.0.1:8200"
    );
  });

  it("rejects non-HTTP Vault URLs", () => {
    expect(() => normalizeVaultUrl("javascript:alert(1)")).toThrow(
      "Vault URL must use http or https"
    );
  });
});
