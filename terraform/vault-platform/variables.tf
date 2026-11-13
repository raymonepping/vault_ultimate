variable "vault_addr" {
  description = "The cluster on a published loopback port (scripts/tf.sh)."
  type        = string
}

variable "vault_cacert" {
  description = "The lab CA chain (vault-tls/ca-chain.pem)."
  type        = string
}

variable "namespace" {
  description = "The namespace every object of the story lives in (D9)."
  type        = string
  default     = "tidewell"
}

variable "sync_secret" {
  description = "The one KV secret the story syncs (config/story.json sync.secret); the presenter may read it because Vault requires that to sync it."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9-]+(/[a-z0-9-]+)+$", var.sync_secret))
    error_message = "sync_secret is a lowercase KV path like parcel/delivery-api."
  }
}

variable "act" {
  description = "The act Terraform declares (D10): 0 is the before estate, 6 the finale. scripts/tf.sh passes ACT or .build/act."
  type        = number
  default     = 0
  validation {
    condition     = var.act >= 0 && var.act <= 6 && floor(var.act) == var.act
    error_message = "act is a whole number from 0 to 6."
  }
}

variable "cert_ttl" {
  description = "The booking site's certificate lifetime from act 3, in seconds (VULT_CERT_TTL; scripts/tf.sh converts)."
  type        = number
  default     = 3600
}

variable "lease_ttl" {
  description = "The booking app's database lease from act 2, in seconds (VULT_LEASE_TTL; scripts/tf.sh converts)."
  type        = number
  default     = 900
}

variable "keycloak_issuer" {
  description = "Keycloak's browser-facing issuer for realm tidewell (the iss Vault binds)."
  type        = string
  default     = "https://localhost:14203/realms/tidewell"
}

variable "booking_ip" {
  description = "The booking container's fixed address (VULT_BOOKING_IP): the AppRole binds its /32."
  type        = string
  default     = "10.89.28.70"
}

variable "ldap_connected" {
  description = "Vault's LDAP engine has its connection (written by the act-4 wave; scripts/tf.sh reads .build/ldap-connected)."
  type        = bool
  default     = false
}

variable "obo_issuer" {
  description = "The delegation token's issuer: the booking app (act 5)."
  type        = string
  default     = "https://localhost:14202"
}

variable "obo_audience" {
  description = "The delegation token's audience: Tidewell's Vault (act 5)."
  type        = string
  default     = "https://vault.tidewell.example"
}
