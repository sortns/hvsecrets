export class VaultClientError extends Error {
  readonly status: number;
  readonly errors: readonly string[];

  constructor(message: string, status: number, errors: readonly string[] = []) {
    super(message);
    this.name = "VaultClientError";
    this.status = status;
    this.errors = errors;
  }
}
