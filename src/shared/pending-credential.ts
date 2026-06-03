export interface PendingCredential {
  readonly origin: string;
  readonly url: string;
  readonly title: string;
  readonly username: string;
  readonly password: string;
  readonly capturedAt: string;
}

export interface CapturedCredentialInput {
  readonly url: string;
  readonly title: string;
  readonly username: string;
  readonly password: string;
}
