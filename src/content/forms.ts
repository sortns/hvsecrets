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
  "input[type='text']",
];

export function findLoginFormFields(
  root: ParentNode = document,
): LoginFormFields | null {
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

// Where a freshly generated password should go. Prefer fields the page
// marks as new-password (sign-up/change forms), then the field the user was
// in before opening the popup plus its confirmation field, then a plain
// sign-up form with one or two password fields. Anything else is ambiguous
// (e.g. a change form with current + new + confirm and no hints) and is
// left for the user to focus explicitly.
export function findNewPasswordInputs(
  root: ParentNode = document,
  activeElement: Element | null = document.activeElement,
): HTMLInputElement[] {
  const passwordInputs = Array.from(
    root.querySelectorAll<HTMLInputElement>("input[type='password']"),
  ).filter(isUsableInput);
  const markedNew = passwordInputs.filter((input) =>
    input.autocomplete.split(/\s+/).includes("new-password"),
  );

  if (markedNew.length > 0) {
    return markedNew;
  }

  const candidates = passwordInputs.filter(
    (input) => !input.autocomplete.split(/\s+/).includes("current-password"),
  );
  const activeIndex = candidates.findIndex((input) => input === activeElement);

  if (activeIndex !== -1) {
    const active = candidates[activeIndex];
    const hasNext = activeIndex + 1 < candidates.length;

    return hasNext && candidates[activeIndex + 1].form === active.form
      ? [active, candidates[activeIndex + 1]]
      : [active];
  }

  // Up to two unhinted fields is a sign-up form (password + confirm);
  // fields hinted as current-password were already excluded above.
  return candidates.length <= 2 ? candidates : [];
}

export function isUsableInput(input: HTMLInputElement): boolean {
  return !input.disabled && !input.readOnly && isVisible(input);
}

function findPasswordInput(root: ParentNode): HTMLInputElement | null {
  const passwordInputs = Array.from(
    root.querySelectorAll<HTMLInputElement>("input[type='password']"),
  );

  return passwordInputs.find(isUsableInput) ?? null;
}

function findUsernameInput(
  root: ParentNode,
  password: HTMLInputElement,
): HTMLInputElement | null {
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
