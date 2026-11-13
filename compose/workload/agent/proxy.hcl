# compose/workload/agent/proxy.hcl: act 5 on (agent-init copies it when the
# wave says act >= 5). Agent's API proxy on the loopback of the booking
# container's network namespace: only the booking app reaches it, and Agent
# adds its own token, so the app signs delegation tokens with Transit key obo
# (policy vult-booking) without ever holding a Vault token or a key.
api_proxy {
  use_auto_auth_token = true
}

listener "tcp" {
  address     = "127.0.0.1:8100"
  tls_disable = true
}
