# Two devices per node: a file in the node's audit volume and stdout (the
# container log). Vault refuses a request only if no device can write. HMAC
# stays on: the audit log shows who imported, synced and rotated, never a value.
resource "vault_audit" "file" {
  type        = "file"
  path        = "file"
  description = "The lab's audit trail"
  options = {
    file_path = "/vault/audit/audit.log"
    mode      = "0640"
  }
}

resource "vault_audit" "stdout" {
  type        = "file"
  path        = "stdout"
  description = "Second device: the container log"
  options = {
    file_path = "stdout"
  }
}
