# Act 0: people sign in to Vault with their Keycloak token (jwt auth, JWKS
# over TLS, the browser-facing issuer: probe P25, P26). Keycloak's groups map
# onto external identity groups that carry the policies; no person holds a
# Vault password. Saskia (platform) runs the acts with her own token (D14).
resource "vault_jwt_auth_backend" "people" {
  provider     = vault.tidewell
  path         = "jwt"
  type         = "jwt"
  description  = "Tidewell people, through Keycloak"
  jwks_url     = "https://keycloak:8443/realms/tidewell/protocol/openid-connect/certs"
  jwks_ca_pem  = file(var.vault_cacert)
  bound_issuer = var.keycloak_issuer
}

resource "vault_jwt_auth_backend_role" "person" {
  provider        = vault.tidewell
  backend         = vault_jwt_auth_backend.people.path
  role_name       = "person"
  role_type       = "jwt"
  user_claim      = "preferred_username"
  groups_claim    = "groups"
  bound_audiences = ["tidewell-vault"]
  token_ttl       = 3600
  token_max_ttl   = 14400
  token_type      = "service"
}

resource "vault_identity_group" "people" {
  for_each = { platform = [vault_policy.presenter.name], bookings = [] }
  provider = vault.tidewell
  name     = each.key
  type     = "external"
  policies = each.value
}

resource "vault_identity_group_alias" "people" {
  for_each       = vault_identity_group.people
  provider       = vault.tidewell
  name           = each.key
  mount_accessor = vault_jwt_auth_backend.people.accessor
  canonical_id   = each.value.id
}
