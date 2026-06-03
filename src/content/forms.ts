export interface LoginFormFields {
  readonly username: HTMLInputElement;
  readonly password: HTMLInputElement;
}

const usernameSelectors = [
  "input[autocomplete='username']",
  "input[type='email']",
  "input[name*='user' i]",
  "input[id*='user' i]",
  "input[name*='login' i]",
  "input[id*='login' i]",
  "input[type='text']"
];

export function findLoginFormFields(root: ParentNode = document): LoginFormFields | null {
  const password = findPasswordInput(root);

  if (password === null) {
    return null;
  }

  const username = findUsernameInput(root, password);

  if (username === null) {
    return null;
  }

  return { username, password };
}

export function isUsableInput(input: HTMLInputElement): boolean {
  return !input.disabled && !input.readOnly && isVisible(input);
}

function findPasswordInput(root: ParentNode): HTMLInputElement | null {
  const passwordInputs = Array.from(
    root.querySelectorAll<HTMLInputElement>("input[type='password']")
  );

  return passwordInputs.find(isUsableInput) ?? null;
}

function findUsernameInput(root: ParentNode, password: HTMLInputElement): HTMLInputElement | null {
  const searchRoot = password.form ?? root;

  for (const selector of usernameSelectors) {
    const input = searchRoot.querySelector<HTMLInputElement>(selector);

    if (input !== null && input !== password && isUsableInput(input)) {
      return input;
    }
  }

  return null;
}

function isVisible(input: HTMLInputElement): boolean {
  return input.offsetParent !== null || input.getClientRects().length > 0;
}
