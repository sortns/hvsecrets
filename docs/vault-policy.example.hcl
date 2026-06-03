path "firefox/data/firefox-vault/*" {
  capabilities = ["create", "read", "update", "delete"]
}

path "firefox/metadata/firefox-vault/*" {
  capabilities = ["list", "read", "delete"]
}
