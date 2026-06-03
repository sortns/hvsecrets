path "firefox/data/hvsecrets/*" {
  capabilities = ["create", "read", "update", "delete"]
}

path "firefox/metadata/hvsecrets/*" {
  capabilities = ["list", "read", "delete"]
}
