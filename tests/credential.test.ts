import { describe, expect, it } from "vitest";
import {
  assertCredentialRecord,
  createCredentialRecord,
  credentialSchemaVersion,
  isCredentialRecord
} from "../src/vault/credential";

describe("credential schema", () => {
  it("creates versioned credential records", () => {
    const credential = createCredentialRecord({
      origin: "https://example.com",
      username: "alice@example.com",
      password: "password",
      url: "https://example.com/login"
    });

    expect(credential.schema).toBe(credentialSchemaVersion);
    expect(credential.realm).toBeNull();
    expect(credential.tags).toEqual([]);
    expect(isCredentialRecord(credential)).toBe(true);
  });

  it("rejects malformed records", () => {
    expect(isCredentialRecord({ schema: credentialSchemaVersion, username: "alice" })).toBe(false);
    expect(() => {
      assertCredentialRecord({ schema: 2 });
    }).toThrow("Invalid credential record schema");
  });
});
