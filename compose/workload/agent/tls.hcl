# compose/workload/agent/tls.hcl: act 3 on (agent-init copies it when the
# wave says act >= 3). The booking site's certificate lives an hour; Agent
# issues a new one before it ends. Both templates make the same pki/issue
# call, which Agent fetches once, so the certificate and the key belong
# together. The key comes first: the app reloads when cert.pem changes.
# Contents sit at the EOT marker's indent: <<-EOT strips only that much.
template {
  destination = "/vault/out/tls/key.pem"
  perms       = "0600"
  contents    = <<-EOT
  {{ with secret "pki/issue/booking" "common_name=booking" "alt_names=localhost" (printf "ip_sans=127.0.0.1,%s" (env "BOOKING_IP")) }}{{ .Data.private_key }}{{ end }}
  EOT
}

template {
  destination = "/vault/out/tls/cert.pem"
  perms       = "0600"
  contents    = <<-EOT
  {{ with secret "pki/issue/booking" "common_name=booking" "alt_names=localhost" (printf "ip_sans=127.0.0.1,%s" (env "BOOKING_IP")) }}{{ .Data.certificate }}
  {{ .Data.issuing_ca }}{{ end }}
  EOT
}
