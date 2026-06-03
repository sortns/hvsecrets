export function normalizeOrigin(input: string): string {
  const url = new URL(input);

  return url.origin;
}

export function originPathSegment(origin: string): string {
  const url = new URL(origin);

  return `${url.protocol.replace(":", "")}.${url.hostname}${url.port.length > 0 ? `.${url.port}` : ""}`;
}
