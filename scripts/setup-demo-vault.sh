#!/usr/bin/env bash
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://127.0.0.1:8200}"
VAULT_KV_MOUNT="${VAULT_KV_MOUNT:-firefox}"
VAULT_BASE_PATH="${VAULT_BASE_PATH:-firefox-vault}"
VAULT_POLICY_NAME="${VAULT_POLICY_NAME:-firefox-vault-dev}"

if ! command -v vault >/dev/null 2>&1; then
  echo "vault CLI is required" >&2
  exit 1
fi

if [[ -z "${VAULT_TOKEN:-}" ]]; then
  echo "VAULT_TOKEN must be set in the shell running this script" >&2
  exit 1
fi

export VAULT_ADDR

if ! vault secrets list -format=json | grep -q "\"${VAULT_KV_MOUNT}/\""; then
  vault secrets enable -path="${VAULT_KV_MOUNT}" kv-v2
fi

policy_file="$(mktemp)"
trap 'rm -f "${policy_file}"' EXIT

cat >"${policy_file}" <<POLICY
path "${VAULT_KV_MOUNT}/data/${VAULT_BASE_PATH}/*" {
  capabilities = ["create", "read", "update", "delete"]
}

path "${VAULT_KV_MOUNT}/metadata/${VAULT_BASE_PATH}/*" {
  capabilities = ["list", "read", "delete"]
}
POLICY

vault policy write "${VAULT_POLICY_NAME}" "${policy_file}"

cat <<EOF
Demo Vault setup complete.

Vault URL:       ${VAULT_ADDR}
KV mount:        ${VAULT_KV_MOUNT}
Base path:       ${VAULT_BASE_PATH}
Policy name:     ${VAULT_POLICY_NAME}

Create or choose a token with this policy, then configure the extension with:
  Vault URL:        ${VAULT_ADDR}
  KV mount:         ${VAULT_KV_MOUNT}
  Base secret path: ${VAULT_BASE_PATH}
EOF
