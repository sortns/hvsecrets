import { afterEach, describe, expect, it, vi } from "vitest";

describe("background script entry point", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("still handles runtime messages when contextMenus is unavailable, like on Firefox for Android", async () => {
    vi.resetModules();

    const storageValues: Record<string, unknown> = {};
    const messageListeners: ((message: unknown, sender: unknown) => unknown)[] =
      [];

    vi.stubGlobal("browser", {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: {
          addListener: (
            listener: (message: unknown, sender: unknown) => unknown,
          ) => {
            messageListeners.push(listener);
          },
        },
      },
      storage: {
        local: {
          get(keys?: string | string[] | Record<string, unknown> | null) {
            if (typeof keys === "string") {
              return Promise.resolve({ [keys]: storageValues[keys] });
            }

            return Promise.resolve({ ...storageValues });
          },
          set(items: Record<string, unknown>) {
            Object.assign(storageValues, items);
            return Promise.resolve();
          },
        },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn(),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      // contextMenus is intentionally absent: Firefox for Android does not
      // implement this API, and the background script must not depend on it
      // being present in order to keep handling messages.
    });

    await import("../src/background/index");

    expect(messageListeners).toHaveLength(1);

    const response = await messageListeners[0]?.({ type: "config.get" }, {});

    expect(response).toEqual(
      expect.objectContaining({ type: "config.state" }),
    );
  });
});
