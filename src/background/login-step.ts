import type { ExtensionStorageArea } from "./storage";

// Multi-step logins (Google, Microsoft, many banks) ask for the username on
// one screen and the password on the next, sometimes after a navigation.
// Remember the username from the first step per tab so the password step
// can offer the right credential and the save prompt knows whose password
// it is. Only the username is kept, never the password, and only briefly.
export const loginStepStorageKey = "hvSecrets.loginSteps";
const loginStepTtlMs = 10 * 60 * 1000;

interface LoginStep {
  readonly origin: string;
  readonly username: string;
  readonly savedAt: number;
}

type LoginSteps = Record<string, LoginStep>;

export async function rememberLoginStep(
  storage: ExtensionStorageArea,
  tabId: number,
  origin: string,
  username: string,
  now: number = Date.now(),
): Promise<void> {
  const steps = pruneExpired(await readSteps(storage), now);
  steps[String(tabId)] = { origin, username, savedAt: now };
  await storage.set({ [loginStepStorageKey]: steps });
}

export async function getLoginStepUsername(
  storage: ExtensionStorageArea,
  tabId: number,
  origin: string,
  now: number = Date.now(),
): Promise<string | null> {
  const step = (await readSteps(storage))[String(tabId)] as
    | LoginStep
    | undefined;

  return step?.origin === origin &&
    now - step.savedAt < loginStepTtlMs
    ? step.username
    : null;
}

export async function clearLoginStep(
  storage: ExtensionStorageArea,
  tabId: number,
): Promise<void> {
  const steps = await readSteps(storage);

  if (!Object.hasOwn(steps, String(tabId))) {
    return;
  }

  Reflect.deleteProperty(steps, String(tabId));
  await storage.set({ [loginStepStorageKey]: steps });
}

// Fallback when browser.storage.session isn't available: background memory.
export function createMemoryStorageArea(): ExtensionStorageArea {
  const values: Record<string, unknown> = {};

  return {
    get(keys) {
      if (typeof keys === "string") {
        return Promise.resolve({ [keys]: values[keys] });
      }

      return Promise.resolve({ ...values });
    },
    set(items) {
      Object.assign(values, items);
      return Promise.resolve();
    },
  };
}

async function readSteps(storage: ExtensionStorageArea): Promise<LoginSteps> {
  const value = (await storage.get(loginStepStorageKey))[loginStepStorageKey];

  if (typeof value !== "object" || value === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, LoginStep] => isLoginStep(entry[1]),
    ),
  );
}

function pruneExpired(steps: LoginSteps, now: number): LoginSteps {
  return Object.fromEntries(
    Object.entries(steps).filter(
      ([, step]) => now - step.savedAt < loginStepTtlMs,
    ),
  );
}

function isLoginStep(value: unknown): value is LoginStep {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const step = value as Record<string, unknown>;

  return (
    typeof step.origin === "string" &&
    typeof step.username === "string" &&
    typeof step.savedAt === "number"
  );
}
