import { findLoginFormFields } from "./forms";
import type { RuntimeRequest, RuntimeResponse } from "../shared/messages";
import type { CredentialSummary } from "../vault/credential-repository";
import type { PendingCredential } from "../shared/pending-credential";
import {
  isFillCredentialMessage,
  type FillCredentialMessage,
} from "../shared/content-messages";

const rootId = "hvsecrets-inline-root";
const menuGapPx = 8;
let menuElement: HTMLDivElement | null = null;
let savePromptElement: HTMLDivElement | null = null;
let menuAnchorInputs: readonly HTMLInputElement[] = [];

installInlineStyles();
attachFormListeners();
void renderPendingSavePrompt();

browser.runtime.onMessage.addListener((message: unknown) => {
  if (!isFillCredentialMessage(message)) {
    return Promise.resolve(undefined);
  }

  return Promise.resolve(fillCredential(message.credential));
});

function attachFormListeners(): void {
  document.addEventListener(
    "submit",
    (event) => {
      void captureSubmittedCredential(
        event.target instanceof HTMLFormElement ? event.target : document,
      );
    },
    true,
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      if (isLoginActionTarget(event.target)) {
        void captureSubmittedCredential(document);
      }
    },
    true,
  );

  document.addEventListener(
    "focusin",
    (event) => {
      if (event.target instanceof HTMLInputElement) {
        void maybeShowCredentialMenu(event.target);
      }
    },
    true,
  );

  document.addEventListener(
    "input",
    (event) => {
      if (
        event.target instanceof HTMLInputElement &&
        isPasswordField(event.target) &&
        !isMenuAnchorTarget(event.target)
      ) {
        hideCredentialMenu();
      }
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.target instanceof HTMLInputElement &&
        isPasswordField(event.target)
      ) {
        if (event.key === "Escape") {
          hideCredentialMenu();
          return;
        }

        if (event.key === "Enter") {
          void captureSubmittedCredential(document);
        }
      }
    },
    true,
  );

  document.addEventListener("click", (event) => {
    if (
      menuElement !== null &&
      event.target instanceof Node &&
      !menuElement.contains(event.target) &&
      !isMenuAnchorTarget(event.target)
    ) {
      hideCredentialMenu();
    }
  });
}

function fillCredential(credential: FillCredentialMessage["credential"]): {
  ok: boolean;
  error?: string;
} {
  const fields = findLoginFormFields();

  if (fields === null) {
    return {
      ok: false,
      error: "No username/password fields found",
    };
  }

  setInputValue(fields.username, credential.username);
  setInputValue(fields.password, credential.password);
  hideCredentialMenu();

  return { ok: true };
}

async function maybeShowCredentialMenu(
  target: HTMLInputElement,
): Promise<void> {
  const fields = findLoginFormFields();

  if (
    fields === null ||
    (target !== fields.username && target !== fields.password)
  ) {
    hideCredentialMenu();
    return;
  }

  suppressNativeAutocomplete(fields);

  const response = await sendRuntimeRequest({
    type: "credentials.listForSenderOrigin",
  });

  if (
    response.type !== "credentials.list" ||
    response.credentials.length === 0
  ) {
    hideCredentialMenu();
    return;
  }

  showCredentialMenu(target, response.credentials);
}

function showCredentialMenu(
  anchor: HTMLInputElement,
  credentials: readonly CredentialSummary[],
): void {
  hideCredentialMenu();

  const menu = document.createElement("div");
  menu.id = rootId;
  menu.className = "hvsecrets-menu";

  for (const credential of credentials) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = credential.username;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      void fillCredentialFromVault(credential.id);
    });
    menu.append(button);
  }

  document.documentElement.append(menu);
  positionMenu(anchor, menu);
  menuElement = menu;
  const fields = findLoginFormFields();
  menuAnchorInputs =
    fields === null ? [anchor] : [fields.username, fields.password];
}

async function fillCredentialFromVault(credentialId: string): Promise<void> {
  await sendRuntimeRequest({
    type: "credentials.fillSenderOrigin",
    credentialId,
  });
  hideCredentialMenu();
}

function hideCredentialMenu(): void {
  menuElement?.remove();
  menuElement = null;
  menuAnchorInputs = [];
}

function suppressNativeAutocomplete(fields: {
  readonly username: HTMLInputElement;
  readonly password: HTMLInputElement;
}): void {
  fields.username.autocomplete = "off";
  fields.password.autocomplete = "off";
  fields.password.form?.setAttribute("autocomplete", "off");
}

function isMenuAnchorTarget(target: Node): boolean {
  return menuAnchorInputs.some((input) => input === target);
}

function isPasswordField(input: HTMLInputElement): boolean {
  return input.type === "password";
}

function isLoginActionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const action = target.closest<HTMLElement>(
    "button, input[type='submit'], input[type='button'], [role='button'], .x-btn",
  );

  if (action === null) {
    return false;
  }

  const primaryLabel =
    action instanceof HTMLInputElement ? action.value : action.textContent;
  const fallbackLabel = action.getAttribute("aria-label") ?? "";
  const label = (
    primaryLabel.trim().length === 0 ? fallbackLabel : primaryLabel
  ).trim();

  return /^(log ?in|sign ?in|войти|вход)$/i.test(label);
}

function positionMenu(anchor: HTMLElement, menu: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  const rightX = rect.right + window.scrollX + menuGapPx;
  const leftX = rect.left + window.scrollX - menuRect.width - menuGapPx;
  const belowY = rect.bottom + window.scrollY + menuGapPx;
  const alignedY = clamp(
    rect.top + window.scrollY,
    window.scrollY + menuGapPx,
    window.scrollY + viewportHeight - menuRect.height - menuGapPx,
  );

  if (rect.right + menuGapPx + menuRect.width <= viewportWidth) {
    menu.style.left = `${String(Math.round(rightX))}px`;
    menu.style.top = `${String(Math.round(alignedY))}px`;
    menu.style.minWidth = `${String(Math.round(rect.width))}px`;
    return;
  }

  if (rect.left - menuGapPx - menuRect.width >= 0) {
    menu.style.left = `${String(Math.round(leftX))}px`;
    menu.style.top = `${String(Math.round(alignedY))}px`;
    menu.style.minWidth = `${String(Math.round(rect.width))}px`;
    return;
  }

  menu.style.left = `${String(Math.round(rect.left + window.scrollX))}px`;
  menu.style.top = `${String(Math.round(belowY))}px`;
  menu.style.minWidth = `${String(Math.round(rect.width))}px`;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

async function captureSubmittedCredential(root: ParentNode): Promise<void> {
  const fields = findLoginFormFields(root);

  if (
    fields === null ||
    fields.username.value.trim().length === 0 ||
    fields.password.value.length === 0
  ) {
    return;
  }

  const response = await sendRuntimeRequest({
    type: "credentials.captureLoginAttempt",
    credential: {
      url: window.location.href,
      title: document.title,
      username: fields.username.value.trim(),
      password: fields.password.value,
    },
  });

  if (response.type === "credentials.captureResult" && response.ok) {
    await renderPendingSavePrompt();
  }
}

async function renderPendingSavePrompt(): Promise<void> {
  const response = await sendRuntimeRequest({
    type: "credentials.pendingForSenderOrigin",
  });

  if (response.type !== "credentials.pending" || response.credential === null) {
    hideSavePrompt();
    return;
  }

  showSavePrompt(response.credential);
}

function showSavePrompt(credential: PendingCredential): void {
  hideSavePrompt();

  const prompt = document.createElement("div");
  prompt.className = "hvsecrets-save-prompt";

  const title = document.createElement("strong");
  title.textContent = "Save login?";

  const username = document.createElement("span");
  username.textContent = credential.username;

  const actions = document.createElement("div");
  actions.className = "hvsecrets-actions";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", () => {
    void savePendingCredential();
  });

  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.textContent = "Dismiss";
  dismissButton.addEventListener("click", () => {
    void dismissPendingCredential();
  });

  const ignoreButton = document.createElement("button");
  ignoreButton.type = "button";
  ignoreButton.textContent = "Ignore this origin";
  ignoreButton.addEventListener("click", () => {
    void ignoreCurrentOrigin();
  });

  actions.append(saveButton, dismissButton, ignoreButton);
  prompt.append(title, username, actions);
  document.documentElement.append(prompt);
  savePromptElement = prompt;
}

function hideSavePrompt(): void {
  savePromptElement?.remove();
  savePromptElement = null;
}

async function savePendingCredential(): Promise<void> {
  const response = await sendRuntimeRequest({
    type: "credentials.savePendingForSenderOrigin",
  });

  if (response.type === "credentials.saveResult" && response.ok) {
    hideSavePrompt();
  }
}

async function dismissPendingCredential(): Promise<void> {
  await sendRuntimeRequest({
    type: "credentials.dismissPendingForSenderOrigin",
  });
  hideSavePrompt();
}

async function ignoreCurrentOrigin(): Promise<void> {
  await sendRuntimeRequest({ type: "credentials.ignoreSenderOrigin" });
  hideSavePrompt();
}

function setInputValue(input: HTMLInputElement, value: string): void {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function sendRuntimeRequest(
  request: RuntimeRequest,
): Promise<RuntimeResponse> {
  return browser.runtime.sendMessage(request) as Promise<RuntimeResponse>;
}

function installInlineStyles(): void {
  if (document.getElementById("hvsecrets-inline-styles") !== null) {
    return;
  }

  const style = document.createElement("style");
  style.id = "hvsecrets-inline-styles";
  style.textContent = `
    @media (prefers-color-scheme: light) {
      :root {
        --hvsecrets-bg: #ffffff;
        --hvsecrets-fg: #111111;
        --hvsecrets-border: #8a8f98;
        --hvsecrets-hover: #e8f0fe;
        --hvsecrets-shadow: rgb(0 0 0 / 18%);
      }
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --hvsecrets-bg: #1d211c;
        --hvsecrets-fg: #f4f5f0;
        --hvsecrets-border: #60685d;
        --hvsecrets-hover: #2d3a31;
        --hvsecrets-shadow: rgb(0 0 0 / 42%);
      }
    }

    .hvsecrets-menu {
      background: var(--hvsecrets-bg);
      border: 1px solid var(--hvsecrets-border);
      border-radius: 4px;
      box-shadow: 0 8px 24px var(--hvsecrets-shadow);
      box-sizing: border-box;
      color: var(--hvsecrets-fg);
      display: grid;
      font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      gap: 2px;
      max-width: 360px;
      padding: 4px;
      position: absolute;
      z-index: 2147483647;
    }

    .hvsecrets-menu button,
    .hvsecrets-save-prompt button {
      background: var(--hvsecrets-bg);
      border: 0;
      border-radius: 3px;
      color: var(--hvsecrets-fg);
      cursor: pointer;
      font: inherit;
      padding: 8px 10px;
      text-align: left;
    }

    .hvsecrets-menu button:hover,
    .hvsecrets-save-prompt button:hover {
      background: var(--hvsecrets-hover);
    }

    .hvsecrets-save-prompt {
      background: var(--hvsecrets-bg);
      border: 1px solid var(--hvsecrets-border);
      border-radius: 6px;
      bottom: 20px;
      box-shadow: 0 8px 24px var(--hvsecrets-shadow);
      color: var(--hvsecrets-fg);
      display: grid;
      font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      gap: 8px;
      padding: 12px;
      position: fixed;
      right: 20px;
      width: min(320px, calc(100vw - 40px));
      z-index: 2147483647;
    }

    .hvsecrets-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
  `;
  document.documentElement.append(style);
}
