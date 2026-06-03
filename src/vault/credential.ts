import { nowIsoString } from "../shared/clock";

export const credentialSchemaVersion = 1;

export type CredentialSchemaVersion = typeof credentialSchemaVersion;

export interface CredentialRecord {
  readonly schema: CredentialSchemaVersion;
  readonly origin: string;
  readonly realm: string | null;
  readonly username: string;
  readonly password: string;
  readonly url: string;
  readonly title: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly tags: readonly string[];
  readonly notes: string;
}

export interface NewCredentialRecordInput {
  readonly origin: string;
  readonly username: string;
  readonly password: string;
  readonly url: string;
  readonly title?: string;
  readonly realm?: string | null;
  readonly tags?: readonly string[];
  readonly notes?: string;
}

export function createCredentialRecord(input: NewCredentialRecordInput): CredentialRecord {
  const timestamp = nowIsoString();

  return {
    schema: credentialSchemaVersion,
    origin: input.origin,
    realm: input.realm ?? null,
    username: input.username,
    password: input.password,
    url: input.url,
    title: input.title ?? "",
    created_at: timestamp,
    updated_at: timestamp,
    tags: input.tags ?? [],
    notes: input.notes ?? ""
  };
}

export function updateCredentialRecord(
  current: CredentialRecord,
  input: NewCredentialRecordInput
): CredentialRecord {
  return {
    ...current,
    origin: input.origin,
    username: input.username,
    password: input.password,
    url: input.url,
    title: input.title ?? "",
    updated_at: nowIsoString()
  };
}

export function isCredentialRecord(value: unknown): value is CredentialRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.schema === credentialSchemaVersion &&
    typeof value.origin === "string" &&
    (typeof value.realm === "string" || value.realm === null) &&
    typeof value.username === "string" &&
    typeof value.password === "string" &&
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    typeof value.notes === "string"
  );
}

export function assertCredentialRecord(value: unknown): asserts value is CredentialRecord {
  if (!isCredentialRecord(value)) {
    throw new Error("Invalid credential record schema");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
