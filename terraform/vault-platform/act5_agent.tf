# Act 5: the AI agent loses its static key and acts with delegated authority
# (D21, probe Q6). The booking app issues an at+jwt for the signed-in clerk
# (sub teun, act.sub tide-agent, one crossing's rebook permit) and signs it
# with Transit key obo, which never leaves Vault. Vault's OAuth resource
# server profile trusts that key; the entities are found by their
# profile_name aliases; the agent's ceiling (agent-registry, registered by
# the act-5 wave) allows rebook only, whatever the clerk may do.
locals {
  act5    = var.act >= 5 ? 1 : 0
  obo_pem = local.act5 == 1 ? jsondecode(data.vault_generic_secret.obo_key[0].data_json).keys["1"].public_key : ""
}

resource "vault_mount" "transit" {
  count       = local.act5
  provider    = vault.tidewell
  path        = "transit"
  type        = "transit"
  description = "The booking app's delegation signing key"
}

# The key through the plain endpoint: the provider's transit key resource
# always writes keys/<name>/config, which the bootstrap policy denies to
# Terraform on purpose (nobody may make a key exportable or deletable).
# Unmounting transit/ (any act below 5) removes it.
resource "vault_generic_endpoint" "obo_key" {
  count                = local.act5
  provider             = vault.tidewell
  path                 = "${vault_mount.transit[0].path}/keys/obo"
  ignore_absent_fields = true
  disable_delete       = true
  data_json            = jsonencode({ type = "ecdsa-p256", exportable = false })
}

data "vault_generic_secret" "obo_key" {
  count      = local.act5
  provider   = vault.tidewell
  path       = vault_generic_endpoint.obo_key[0].path
  depends_on = [vault_generic_endpoint.obo_key]
}

resource "vault_generic_endpoint" "obo_profile" {
  count                = local.act5
  provider             = vault.tidewell
  path                 = "sys/config/oauth-resource-server/booking-obo"
  ignore_absent_fields = true
  data_json = jsonencode({
    issuer_id            = var.obo_issuer
    use_jwks             = false
    public_keys          = [{ key_id = "obo-1", pem = local.obo_pem }]
    audiences            = [var.obo_audience]
    supported_algorithms = ["ES256"]
    user_claim           = "sub"
    actor_claim          = "act.sub"
  })
}

resource "vault_policy" "obo" {
  for_each = local.act5 == 1 ? {
    teun          = "# Teun, a booking clerk: may rebook and cancel on any crossing.\npath \"kv/data/permits/rebook/*\" { capabilities = [\"read\"] }\npath \"kv/data/permits/cancel/*\" { capabilities = [\"read\"] }\n"
    agent-ceiling = "# tide-agent's ceiling: rebook only, whatever the clerk delegates.\npath \"kv/data/permits/rebook/*\" { capabilities = [\"read\"] }\n"
  } : {}
  provider = vault.tidewell
  name     = "vult-${each.key}"
  policy   = each.value
}

resource "vault_identity_entity" "obo" {
  for_each = local.act5 == 1 ? { teun = [vault_policy.obo["teun"].name], tide-agent = [] } : {}
  provider = vault.tidewell
  name     = each.key
  policies = each.value
}

# The profile finds an entity by an alias named for the claim's value. The
# alias endpoint only creates, so it is neither read nor deleted here:
# removing the entity removes its aliases.
resource "vault_generic_endpoint" "obo_alias" {
  for_each       = vault_identity_entity.obo
  provider       = vault.tidewell
  path           = "identity/entity-alias"
  disable_read   = true
  disable_delete = true
  data_json = jsonencode({
    name         = each.key
    canonical_id = each.value.id
    profile_name = "booking-obo"
    external_id  = each.key
  })
  depends_on = [vault_generic_endpoint.obo_profile]
}
