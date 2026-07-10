import { handleRuntimeRequest, type ExtensionOidcTabFlowApi } from "./handlers";
import { isRuntimeRequest } from "../shared/messages";

const vaultContextMenuRootId = "hvsecrets-use-saved-password";
const vaultContextMenuCredentialPrefix = "hvsecrets-fill:";
let vaultContextMenuChildIds: string[] = [];

// Firefox for Android does not implement the contextMenus API. Registering
// listeners on it unconditionally throws during background script startup
// and aborts the rest of this module (including the oidcTabFlow binding
// below), which breaks every runtime message the popup/options/content
// scripts send. Feature-detect it instead of assuming it exists.
const contextMenusApi = (
  browser as unknown as {
    readonly contextMenus?: typeof browser.contextMenus;
  }
).contextMenus;

const oidcTabFlow: ExtensionOidcTabFlowApi = {
  openAuthUrlAndWaitForCallback(authUrl, callbackUrlPrefix) {
    return openAuthUrlAndWaitForCallback(authUrl, callbackUrlPrefix);
  },
};

browser.runtime.onInstalled.addListener(() => {
  void installContextMenu();
});

browser.runtime.onStartup.addListener(() => {
  void installContextMenu();
});

browser.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isRuntimeRequest(message)) {
    return Promise.resolve(undefined);
  }

  return handleRuntimeRequest(
    message,
    browser.storage.local,
    {
      query: (queryInfo) => browser.tabs.query(queryInfo),
      sendMessage: (tabId, request) => browser.tabs.sendMessage(tabId, request),
    },
    sender,
    oidcTabFlow,
  );
});

if (contextMenusApi !== undefined) {
  contextMenusApi.onClicked.addListener((info, tab) => {
    if (typeof info.menuItemId !== "string" || tab === undefined) {
      return;
    }

    if (!info.menuItemId.startsWith(vaultContextMenuCredentialPrefix)) {
      return;
    }

    const credentialId = info.menuItemId.slice(
      vaultContextMenuCredentialPrefix.length,
    );

    void handleRuntimeRequest(
      {
        type: "credentials.fillCurrentTab",
        credentialId,
      },
      browser.storage.local,
      {
        query: () => Promise.resolve([tab]),
        sendMessage: (tabId, request) =>
          browser.tabs.sendMessage(tabId, request),
      },
      { tab },
      oidcTabFlow,
    );
  });

  contextMenusApi.onShown.addListener((_info, tab) => {
    void refreshCredentialContextMenu(tab);
  });
}

async function installContextMenu(): Promise<void> {
  if (contextMenusApi === undefined) {
    return;
  }

  await contextMenusApi.removeAll();
  contextMenusApi.create({
    id: vaultContextMenuRootId,
    title: "HVSecrets: Use saved password",
    contexts: ["editable"],
  });
}

async function refreshCredentialContextMenu(
  tab?: browser.tabs.Tab,
): Promise<void> {
  if (contextMenusApi === undefined) {
    return;
  }

  await removeCredentialContextMenuItems();

  if (tab === undefined) {
    void contextMenusApi.refresh();
    return;
  }

  const response = await handleRuntimeRequest(
    { type: "credentials.listForCurrentTab" },
    browser.storage.local,
    {
      query: () => Promise.resolve([tab]),
      sendMessage: (tabId, request) => browser.tabs.sendMessage(tabId, request),
    },
    { tab },
  );

  if (
    response.type !== "credentials.list" ||
    response.credentials.length === 0
  ) {
    const emptyId = `${vaultContextMenuCredentialPrefix}empty`;
    void contextMenusApi.create({
      id: emptyId,
      parentId: vaultContextMenuRootId,
      title: "No saved logins for this site",
      contexts: ["editable"],
      enabled: false,
    });
    vaultContextMenuChildIds = [emptyId];
    void contextMenusApi.refresh();
    return;
  }

  vaultContextMenuChildIds = response.credentials.map((credential) => {
    const id = `${vaultContextMenuCredentialPrefix}${credential.id}`;
    void contextMenusApi.create({
      id,
      parentId: vaultContextMenuRootId,
      title:
        credential.username.length === 0 ? "No username" : credential.username,
      contexts: ["editable"],
    });
    return id;
  });
  void contextMenusApi.refresh();
}

async function removeCredentialContextMenuItems(): Promise<void> {
  if (contextMenusApi === undefined) {
    vaultContextMenuChildIds = [];
    return;
  }

  await Promise.all(
    vaultContextMenuChildIds.map(async (id) => {
      try {
        await contextMenusApi.remove(id);
      } catch {
        // Context menu items are transient and may already be gone after extension reloads.
      }
    }),
  );
  vaultContextMenuChildIds = [];
}

async function openAuthUrlAndWaitForCallback(
  authUrl: string,
  callbackUrlPrefix: string,
): Promise<string> {
  const tab = await browser.tabs.create({ active: true, url: authUrl });

  if (tab.id === undefined) {
    throw new Error("Unable to open OIDC login tab");
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        cleanup();
        reject(new Error("OIDC login timed out"));
      },
      5 * 60 * 1000,
    );

    const onUpdated = (
      tabId: number,
      changeInfo: browser.tabs._OnUpdatedChangeInfo,
    ): void => {
      if (tabId !== tab.id || changeInfo.url === undefined) {
        return;
      }

      if (!changeInfo.url.startsWith(callbackUrlPrefix)) {
        return;
      }

      cleanup();
      void browser.tabs.remove(tabId).catch(() => undefined);
      resolve(changeInfo.url);
    };

    const onRemoved = (tabId: number): void => {
      if (tabId !== tab.id) {
        return;
      }

      cleanup();
      reject(new Error("OIDC login tab was closed"));
    };

    const cleanup = (): void => {
      clearTimeout(timeout);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
    };

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
  });
}
