# compose/workload/agent/agent.hcl: the booking app's Vault Agent (act 2 on). It
# shares the booking container's network namespace, so Vault sees the
# booking app's address, which the AppRole binds (D9).
#
# auto_auth: the role id, and a secret id that Ansible delivered
# response-wrapped (60 s, single use): Agent unwraps it, logs in once, and
# from then on renews its token. The token lives in a tmpfs sink only.
# templates: the database credential (a lease Agent renews; a new one when
# it ends), and from act 3 the one-hour certificate (tls.hcl).
pid_file = "/tmp/agent.pid"

vault {
  address = "https://vault-1:8200"
  ca_cert = "/vault/ca/ca-chain.pem"
}

auto_auth {
  method "approle" {
    mount_path = "auth/approle"
    namespace  = "tidewell"
    config = {
      role_id_file_path                   = "/vault/in/role-id"
      secret_id_file_path                 = "/vault/in/wrapped-secret-id"
      secret_id_response_wrapping_path    = "auth/approle/role/booking/secret-id"
      remove_secret_id_file_after_reading = false
    }
  }
  sink "file" {
    config = { path = "/vault/sink/token", mode = 0600 }
  }
}

template_config {
  exit_on_retry_failure = false
}

template {
  destination = "/vault/out/db.json"
  perms       = "0600"
  contents    = <<-EOT
  {{ with secret "database/creds/booking" }}{"username": "{{ .Data.username }}", "password": "{{ .Data.password }}", "lease_id": "{{ .LeaseID }}", "lease_seconds": {{ .LeaseDuration }}}{{ end }}
  EOT
}
