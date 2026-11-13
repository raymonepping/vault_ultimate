resource "vault_policy" "presenter" {
  provider = vault.tidewell
  name     = "vult-presenter"
  policy   = templatefile("${path.module}/policies/presenter.hcl.tftpl", { sync_secret = var.sync_secret })
}
