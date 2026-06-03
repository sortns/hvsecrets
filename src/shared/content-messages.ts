const maxUsernameLength = 512;
const maxPasswordLength = 4096;

export interface FillCredentialMessage {
  readonly type: "content.fillCredential";
  readonly credential: {
    readonly username: string;
    readonly password: string;
  };
}

export function isFillCredentialMessage(value: unknown): value is FillCredentialMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const message = value as Record<string, unknown>;
  const credential = message.credential;

  if (
    message.type !== "content.fillCredential" ||
    typeof credential !== "object" ||
    credential === null ||
    Array.isArray(credential)
  ) {
    return false;
  }

  const credentialRecord = credential as Record<string, unknown>;

  return (
    isBoundedString(credentialRecord.username, maxUsernameLength) &&
    isBoundedString(credentialRecord.password, maxPasswordLength)
  );
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}
