import type { CredentialSummary } from "../vault/credential-repository";

// Search reads every credential in the base path, which is the expensive
// part. The popup searches the same index repeatedly while the user types,
// so keep the last result in background memory for a short time. Only
// summaries (no passwords) are cached, and the cache is keyed by the Vault
// target + token so a config change or re-login never serves stale data.
const indexTtlMs = 2 * 60 * 1000;

interface CachedIndex {
  readonly key: string;
  readonly loadedAt: number;
  readonly credentials: readonly CredentialSummary[];
}

let cachedIndex: CachedIndex | null = null;
let inFlight: {
  readonly key: string;
  readonly promise: Promise<readonly CredentialSummary[]>;
} | null = null;

export async function getCredentialIndex(
  key: string,
  load: () => Promise<readonly CredentialSummary[]>,
  options: { readonly refresh?: boolean; readonly now?: number } = {},
): Promise<readonly CredentialSummary[]> {
  const now = options.now ?? Date.now();

  if (
    options.refresh !== true &&
    cachedIndex !== null &&
    cachedIndex.key === key &&
    now - cachedIndex.loadedAt < indexTtlMs
  ) {
    return cachedIndex.credentials;
  }

  // Opening the search panel and typing quickly can ask twice before the
  // first load finishes; share it instead of walking Vault again.
  if (inFlight !== null && inFlight.key === key) {
    return inFlight.promise;
  }

  const entry = { key, promise: load() };
  inFlight = entry;

  try {
    const credentials = await entry.promise;

    // A save/delete that invalidated the index mid-load means this result
    // may already be stale; hand it to the caller but don't keep it.
    if (isCurrent(entry)) {
      cachedIndex = { key, loadedAt: now, credentials };
    }

    return credentials;
  } finally {
    if (isCurrent(entry)) {
      inFlight = null;
    }
  }
}

// A function so the check reads the live module state after an await.
function isCurrent(entry: NonNullable<typeof inFlight>): boolean {
  return inFlight === entry;
}

export function invalidateCredentialIndex(): void {
  cachedIndex = null;
  inFlight = null;
}
