import { describe, expect, it } from "vitest";
import { normalizeOrigin, originPathSegment } from "../src/shared/origin";

describe("normalizeOrigin", () => {
  it("returns the strict URL origin", () => {
    expect(normalizeOrigin("https://example.com/login")).toBe("https://example.com");
    expect(normalizeOrigin("http://example.com/login")).toBe("http://example.com");
    expect(normalizeOrigin("https://app.example.com/login")).toBe("https://app.example.com");
  });

  it("maps origins to Vault-safe path segments", () => {
    expect(originPathSegment("https://example.com")).toBe("https.example.com");
    expect(originPathSegment("http://localhost:8080")).toBe("http.localhost.8080");
  });
});
