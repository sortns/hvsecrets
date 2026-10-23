import { describe, expect, it } from "vitest";
import {
  clearLoginStep,
  createMemoryStorageArea,
  getLoginStepUsername,
  rememberLoginStep,
} from "../src/background/login-step";

describe("multi-step login memory", () => {
  it("returns the username remembered for the same tab and origin", async () => {
    const storage = createMemoryStorageArea();

    await rememberLoginStep(storage, 4, "https://accounts.example", "alice", 0);

    await expect(
      getLoginStepUsername(storage, 4, "https://accounts.example", 1000),
    ).resolves.toBe("alice");
  });

  it("does not leak the username to another tab or origin", async () => {
    const storage = createMemoryStorageArea();

    await rememberLoginStep(storage, 4, "https://accounts.example", "alice", 0);

    await expect(
      getLoginStepUsername(storage, 5, "https://accounts.example", 0),
    ).resolves.toBeNull();
    await expect(
      getLoginStepUsername(storage, 4, "https://evil.example", 0),
    ).resolves.toBeNull();
  });

  it("forgets the username after ten minutes or when cleared", async () => {
    const storage = createMemoryStorageArea();

    await rememberLoginStep(storage, 4, "https://accounts.example", "alice", 0);
    await expect(
      getLoginStepUsername(
        storage,
        4,
        "https://accounts.example",
        10 * 60 * 1000,
      ),
    ).resolves.toBeNull();

    await rememberLoginStep(storage, 4, "https://accounts.example", "alice", 0);
    await clearLoginStep(storage, 4);
    await expect(
      getLoginStepUsername(storage, 4, "https://accounts.example", 0),
    ).resolves.toBeNull();
  });
});
