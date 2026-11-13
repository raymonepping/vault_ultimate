output "namespace" {
  value = vault_namespace.tidewell.path_fq
}

output "jwt_accessor" {
  value = vault_jwt_auth_backend.people.accessor
}

output "act" {
  value = var.act
}

output "kv_accessor" {
  value = vault_mount.kv.accessor
}

output "policies" {
  value = sort([vault_policy.presenter.name])
}
