// A login form may show both fields, or (multi-step logins such as Google)
// only the username on the first screen and only the password on the next.
export type LoginFields =
  | {
      readonly username: HTMLInputElement;
      readonly password: HTMLInputElement | null;
    }
  | {
      readonly username: HTMLInputElement | null;
      readonly password: HTMLInputElement;
    };

// Used next to a password field, where any text input in the same form is
// very likely the username.
const usernameSelectors = [
  "input[autocomplete~='username' i]",
  "input[type='email']",
  "input[name*='user' i]",
  "input[id*='user' i]",
  "input[name*='login' i]",
  "input[id*='login' i]",
  "input[type='text']",
];

// Without a password field a generic text input could be anything (a site
// search box), so the username step needs an explicit signal.
const usernameStepSelectors = [
  "input[autocomplete~='username' i]",
  "input[autocomplete~='email' i]",
  "input[type='email']",
  "input[name*='user' i]",
  "input[id*='user' i]",
  "input[name*='login' i]",
  "input[id*='login' i]",
  "input[name*='email' i]",
  "input[id*='email' i]",
  "input[name*='identifier' i]",
  "input[id*='identifier' i]",
];

const textLikeTypes = new Set(["", "text", "email", "tel"]);

export function findLoginFields(
  root: ParentNode = document,
): LoginFields | null {
  const password = findPasswordInput(root);

  if (password !== null) {
    return { username: findUsernameInput(root, password), password };
  }

  const username = findUsernameStepInput(root);

  return username === null ? null : { username, password: null };
}

// On a password-only step the page often still carries the username: a
// hidden autocomplete=username field (Google's recommended pattern) or a
// read-only field showing the chosen account.
export function findUsernameHint(
  password: HTMLInputElement,
  root: ParentNode = document,
): string | null {
  const searchRoot = password.form ?? root;

  for (const selector of usernameStepSelectors) {
    for (const input of searchRoot.querySelectorAll<HTMLInputElement>(
      selector,
    )) {
      if (
        input !== password &&
        input.type !== "password" &&
        !isUsableInput(input) &&
        input.value.trim().length > 0
      ) {
        return input.value.trim();
      }
    }
  }

  return null;
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

function findUsernameStepInput(root: ParentNode): HTMLInputElement | null {
  for (const selector of usernameStepSelectors) {
    for (const input of root.querySelectorAll<HTMLInputElement>(selector)) {
      if (
        textLikeTypes.has(input.type) &&
        input.getAttribute("role") !== "combobox" &&
        isUsableInput(input)
      ) {
        return input;
      }
    }
  }

  return null;
}

function findUsernameInput(
  root: ParentNode,
  password: HTMLInputElement,
): HTMLInputElement | null {
  const searchRoot = password.form ?? root;

  for (const selector of usernameSelectors) {
    for (const input of searchRoot.querySelectorAll<HTMLInputElement>(
      selector,
    )) {
      // name*='user' also matches "remember_user" checkboxes and hidden
      // inputs; only a visible text-like field can be the username.
      if (
        input !== password &&
        textLikeTypes.has(input.type) &&
        isUsableInput(input)
      ) {
        return input;
      }
    }
  }

  return null;
}

function isVisible(input: HTMLInputElement): boolean {
  return input.offsetParent !== null || input.getClientRects().length > 0;
}
