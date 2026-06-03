const segmentPattern = /^[A-Za-z0-9._-]+$/;

export function normalizeVaultPath(input: string): string {
  const trimmed = input.trim().replace(/^\/+|\/+$/g, "");

  if (trimmed.length === 0) {
    throw new Error("Vault path must not be empty");
  }

  const segments = trimmed.split("/");

  for (const segment of segments) {
    if (segment === "." || segment === ".." || !segmentPattern.test(segment)) {
      throw new Error(`Invalid Vault path segment: ${segment}`);
    }
  }

  return segments.join("/");
}

export function joinVaultPath(...parts: string[]): string {
  return normalizeVaultPath(
    parts.filter((part) => part.trim().length > 0).join("/"),
  );
}

export function normalizeVaultUrl(input: string): string {
  const url = new URL(input);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Vault URL must use http or https");
  }

  url.pathname = url.pathname.replace(/\/+$/g, "");
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/$/g, "");
}
