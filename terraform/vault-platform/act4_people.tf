# Act 4: the last static password behind people's sign-in. Keycloak binds to
# OpenLDAP as cn=keycloak-bind; from this act Vault's LDAP secrets engine owns
# that password (probe Q5). The engine's connection carries cn=vault-rotator's
# password, so Ansible writes it (act-4 wave) and then marks
# .build/ldap-connected; only then can Vault create the static role, so the
# wave applies Terraform a second time. Ansible rotates and pushes the new
# password into Keycloak's federation; Terraform never rotates
# (skip_import_rotation), it only declares.
locals {
  act4 = var.act >= 4 ? 1 : 0
}

resource "vault_mount" "ldap" {
  count       = local.act4
  provider    = vault.tidewell
  path        = "ldap"
  type        = "ldap"
  description = "OpenLDAP: the passwords of Tidewell's service accounts"
}

resource "vault_ldap_secret_backend_static_role" "keycloak_bind" {
  count                = var.act >= 4 && var.ldap_connected ? 1 : 0
  provider             = vault.tidewell
  mount                = vault_mount.ldap[0].path
  role_name            = "keycloak-bind"
  username             = "keycloak-bind"
  dn                   = "cn=keycloak-bind,ou=system,dc=tidewell,dc=lab"
  rotation_period      = 2592000 # 30 days; make wake-up pushes a rotated password to Keycloak
  skip_import_rotation = true
}
