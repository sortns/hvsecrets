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

function showSavePrompt(
  credential: PendingCredential,
  errorMessage?: string,
): void {
  hideSavePrompt();

  const prompt = document.createElement("div");
  prompt.className = "hvsecrets-save-prompt";

  const title = document.createElement("strong");
  title.textContent = "Save login?";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "hvsecrets-close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.addEventListener("click", () => {
    void dismissPendingCredential();
  });

  const username = document.createElement("span");
  username.textContent = credential.username;

  const actions = document.createElement("div");
  actions.className = "hvsecrets-actions";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";
  saveButton.addEventListener("click", () => {
    void savePendingCredential(credential);
  });

  const ignoreButton = document.createElement("button");
  ignoreButton.type = "button";
  ignoreButton.textContent = "Ignore this origin";
  ignoreButton.addEventListener("click", () => {
    void ignoreCurrentOrigin();
  });

  actions.append(saveButton, ignoreButton);
  prompt.append(closeButton, title, username);

  if (errorMessage !== undefined) {
    const error = document.createElement("span");
    error.className = "hvsecrets-save-prompt-error";
    error.textContent = errorMessage;
    prompt.append(error);
  }

  prompt.append(actions);
  document.documentElement.append(prompt);
  savePromptElement = prompt;
}

function hideSavePrompt(): void {
  savePromptElement?.remove();
  savePromptElement = null;
}

async function savePendingCredential(
  credential: PendingCredential,
): Promise<void> {
  let response: RuntimeResponse;

  try {
    response = await sendRuntimeRequest({
      type: "credentials.savePendingForSenderOrigin",
    });
  } catch (error) {
    showSavePrompt(
      credential,
      error instanceof Error ? error.message : "Unable to save credential",
    );
    return;
  }

  if (response.type === "credentials.saveResult" && response.ok) {
    hideSavePrompt();
    return;
  }

  showSavePrompt(
    credential,
    response.type === "credentials.saveResult" && response.error !== undefined
      ? response.error
      : "Unable to save credential",
  );
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
      --hvsecrets-close-icon: url("data:image/png;base64,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");
    }

    .hvsecrets-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .hvsecrets-save-prompt strong {
      display: block;
      padding-right: 22px;
    }

    .hvsecrets-save-prompt .hvsecrets-close {
      background: var(--hvsecrets-close-icon) center / contain no-repeat;
      border: 0;
      box-sizing: border-box;
      cursor: pointer;
      height: 14px;
      opacity: 0.85;
      padding: 0;
      position: absolute;
      right: 10px;
      top: 10px;
      width: 14px;
    }

    .hvsecrets-save-prompt .hvsecrets-close:hover {
      background: var(--hvsecrets-close-icon) center / contain no-repeat;
      opacity: 1;
    }

    .hvsecrets-save-prompt-error {
      color: #d64545;
      font-size: 13px;
    }
  `;
  document.documentElement.append(style);
}
