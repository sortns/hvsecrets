import { handleRuntimeRequest, type ExtensionOidcTabFlowApi } from "./handlers";
import { isRuntimeRequest } from "../shared/messages";

const vaultContextMenuRootId = "firefox-vault-use-saved-password";
const vaultContextMenuCredentialPrefix = "firefox-vault-fill:";
let vaultContextMenuChildIds: string[] = [];

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
      sendMessage: (tabId, request) => browser.tabs.sendMessage(tabId, request)
    },
    sender,
    oidcTabFlow
  );
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (typeof info.menuItemId !== "string" || tab === undefined) {
    return;
  }

  if (!info.menuItemId.startsWith(vaultContextMenuCredentialPrefix)) {
    return;
  }

  const credentialId = info.menuItemId.slice(vaultContextMenuCredentialPrefix.length);

  void handleRuntimeRequest(
    {
      type: "credentials.fillCurrentTab",
      credentialId
    },
    browser.storage.local,
    {
      query: () => Promise.resolve([tab]),
      sendMessage: (tabId, request) => browser.tabs.sendMessage(tabId, request)
    },
    { tab },
    oidcTabFlow
  );
});

browser.contextMenus.onShown.addListener((_info, tab) => {
  void refreshCredentialContextMenu(tab);
});

async function installContextMenu(): Promise<void> {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: vaultContextMenuRootId,
    title: "Firefox Vault: Use saved password",
    contexts: ["editable"]
  });
}

async function refreshCredentialContextMenu(tab?: browser.tabs.Tab): Promise<void> {
  await removeCredentialContextMenuItems();

  if (tab === undefined) {
    void browser.contextMenus.refresh();
    return;
  }

  const response = await handleRuntimeRequest(
    { type: "credentials.listForCurrentTab" },
    browser.storage.local,
    {
      query: () => Promise.resolve([tab]),
      sendMessage: (tabId, request) => browser.tabs.sendMessage(tabId, request)
    },
    { tab }
  );

  if (response.type !== "credentials.list" || response.credentials.length === 0) {
    const emptyId = `${vaultContextMenuCredentialPrefix}empty`;
    void browser.contextMenus.create({
      id: emptyId,
      parentId: vaultContextMenuRootId,
      title: "No saved logins for this site",
      contexts: ["editable"],
      enabled: false
    });
    vaultContextMenuChildIds = [emptyId];
    void browser.contextMenus.refresh();
    return;
  }

  vaultContextMenuChildIds = response.credentials.map((credential) => {
    const id = `${vaultContextMenuCredentialPrefix}${credential.id}`;
    void browser.contextMenus.create({
      id,
      parentId: vaultContextMenuRootId,
      title: credential.username.length === 0 ? "No username" : credential.username,
      contexts: ["editable"]
    });
    return id;
  });
  void browser.contextMenus.refresh();
}

async function removeCredentialContextMenuItems(): Promise<void> {
  await Promise.all(
    vaultContextMenuChildIds.map(async (id) => {
      try {
        await browser.contextMenus.remove(id);
      } catch {
        // Context menu items are transient and may already be gone after extension reloads.
      }
    })
  );
  vaultContextMenuChildIds = [];
}

const oidcTabFlow: ExtensionOidcTabFlowApi = {
  openAuthUrlAndWaitForCallback(authUrl, callbackUrlPrefix) {
    return openAuthUrlAndWaitForCallback(authUrl, callbackUrlPrefix);
  }
};

async function openAuthUrlAndWaitForCallback(
  authUrl: string,
  callbackUrlPrefix: string
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
      5 * 60 * 1000
    );

    const onUpdated = (tabId: number, changeInfo: browser.tabs._OnUpdatedChangeInfo): void => {
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
