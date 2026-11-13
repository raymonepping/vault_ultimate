# Act 2: the booking app proves who it is and gets a lease, not a password.
#
#   AppRole booking   bound to the booking container's /32; a secret id is
#                     used once (secret_id_num_uses = 1) and Ansible delivers
#                     it response-wrapped (D9, probe P08 to P12)
#   database booking  dynamic PostgreSQL credentials, members of booking_rw;
#                     the revocation statements end the role's open sessions
#                     first (probe P04: REVOKE plus DROP ROLE alone left a
#                     session alive 13 s after the revoke)
# The connection (it carries the admin password) is Ansible's (act-2 wave).
locals {
  act2 = var.act >= 2 ? 1 : 0
}

resource "vault_mount" "database" {
  count       = local.act2
  provider    = vault.tidewell
  path        = "database"
  type        = "database"
  description = "Tidewell's booking database: dynamic credentials"
}

resource "vault_database_secret_backend_role" "booking" {
  count    = local.act2
  provider = vault.tidewell
  backend  = vault_mount.database[0].path
  name     = "booking"
  db_name  = "tidewell"
  creation_statements = [
    "CREATE ROLE \"{{name}}\" WITH LOGIN PASSWORD '{{password}}' VALID UNTIL '{{expiration}}' IN ROLE booking_rw;",
  ]
  revocation_statements = [
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '{{name}}';",
    "DROP ROLE IF EXISTS \"{{name}}\";",
  ]
  default_ttl = var.lease_ttl
  max_ttl     = 3600
}

resource "vault_auth_backend" "approle" {
  count       = local.act2
  provider    = vault.tidewell
  type        = "approle"
  path        = "approle"
  description = "Tidewell workloads"
}

resource "vault_approle_auth_backend_role" "booking" {
  count                 = local.act2
  provider              = vault.tidewell
  backend               = vault_auth_backend.approle[0].path
  role_name             = "booking"
  token_policies        = ["vult-booking"]
  secret_id_num_uses    = 1
  secret_id_ttl         = 600
  secret_id_bound_cidrs = ["${var.booking_ip}/32"]
  token_bound_cidrs     = ["${var.booking_ip}/32"]
  token_ttl             = 3600
  token_max_ttl         = 14400
}

resource "vault_policy" "booking" {
  count    = local.act2
  provider = vault.tidewell
  name     = "vult-booking"
  policy   = templatefile("${path.module}/policies/booking.hcl.tftpl", { act = var.act })
}
