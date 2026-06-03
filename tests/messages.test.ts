import { describe, expect, it } from "vitest";
import { isFillCredentialMessage } from "../src/shared/content-messages";
import { isRuntimeRequest } from "../src/shared/messages";

describe("runtime message validation", () => {
  it("accepts well-formed captured credentials", () => {
    expect(
      isRuntimeRequest({
        type: "credentials.captureLoginAttempt",
        credential: {
          url: "https://example.com/login",
          title: "Example",
          username: "alice",
          password: "secret"
        }
      })
    ).toBe(true);
  });

  it("rejects captured credentials from non-page URLs", () => {
    expect(
      isRuntimeRequest({
        type: "credentials.captureLoginAttempt",
        credential: {
          url: "javascript:alert(1)",
          title: "Example",
          username: "alice",
          password: "secret"
        }
      })
    ).toBe(false);
  });

  it("rejects malformed credential IDs", () => {
    expect(
      isRuntimeRequest({
        type: "credentials.fillSenderOrigin",
        credentialId: "../secret"
      })
    ).toBe(false);
  });

  it("rejects oversized secrets at the message boundary", () => {
    expect(
      isRuntimeRequest({
        type: "credentials.saveForCurrentTab",
        username: "alice",
        password: "x".repeat(4097)
      })
    ).toBe(false);
  });

  it("validates ignored origin settings messages", () => {
    expect(
      isRuntimeRequest({
        type: "settings.ignoredOrigins.add",
        origin: "https://example.com/login"
      })
    ).toBe(true);
    expect(
      isRuntimeRequest({
        type: "settings.ignoredOrigins.add",
        origin: "javascript:alert(1)"
      })
    ).toBe(false);
  });

  it("validates content fill messages before touching page fields", () => {
    expect(
      isFillCredentialMessage({
        type: "content.fillCredential",
        credential: {
          username: "alice",
          password: "secret"
        }
      })
    ).toBe(true);
    expect(
      isFillCredentialMessage({
        type: "content.fillCredential",
        credential: {
          username: "alice",
          password: "x".repeat(4097)
        }
      })
    ).toBe(false);
  });
});
