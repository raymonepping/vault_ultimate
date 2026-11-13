# Act 3: the booking site's certificate lives an hour; Vault Agent renews it.
# The year-long role (act0_pki.tf) is gone from this act on.
resource "vault_pki_secret_backend_role" "booking" {
  count              = var.act >= 3 ? 1 : 0
  provider           = vault.tidewell
  backend            = vault_mount.pki.path
  name               = "booking"
  allowed_domains    = ["booking", "localhost"]
  allow_bare_domains = true
  allow_ip_sans      = true
  ttl                = var.cert_ttl
  max_ttl            = var.cert_ttl
  key_type           = "ec"
  key_bits           = 256
}
