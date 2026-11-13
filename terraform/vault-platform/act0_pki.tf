# Act 0: the before estate's certificate authority. Someone once issued the
# booking site a certificate valid for a year from this Vault PKI; the role
# that allowed it (booking-year) exists until act 3 replaces it with
# one-hour certificates (role booking). The mount is an intermediate CA whose
# key Vault generates and keeps; Ansible's pki-ca phase has the lab CA sign
# it on the host, so everything that trusts the lab CA (make trust-root, the
# containers) trusts the booking site. Probe Q4: a certificate cannot outlive
# its CA; OCSP and the CRL answer revocations (act 3, act 6).
locals {
  pki_base = "https://vault-1:8200/v1/${var.namespace}/pki"
}

resource "vault_mount" "pki" {
  provider                  = vault.tidewell
  path                      = "pki"
  type                      = "pki"
  description               = "Tidewell Ferries certificates"
  max_lease_ttl_seconds     = 315360000
  default_lease_ttl_seconds = 3600
}

resource "vault_pki_secret_backend_config_urls" "urls" {
  provider                = vault.tidewell
  backend                 = vault_mount.pki.path
  issuing_certificates    = ["${local.pki_base}/ca"]
  crl_distribution_points = ["${local.pki_base}/crl"]
  ocsp_servers            = ["${local.pki_base}/ocsp"]
}

# The before estate's role: year-long certificates for the booking site.
resource "vault_pki_secret_backend_role" "booking_year" {
  count              = var.act < 3 ? 1 : 0
  provider           = vault.tidewell
  backend            = vault_mount.pki.path
  name               = "booking-year"
  allowed_domains    = ["booking", "localhost"]
  allow_bare_domains = true
  allow_ip_sans      = true
  max_ttl            = "31536000" # 8760h: Vault reads it back in seconds
  ttl                = "31536000"
  key_type           = "ec"
  key_bits           = 256
}
