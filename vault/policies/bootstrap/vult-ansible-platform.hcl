# vult-ansible-platform: Ansible on the cluster (D5 to D7, D10). Order and
# moment: the GitHub App and both sync destinations, the activation flags, the
# connections that carry passwords (PostgreSQL, OpenLDAP), the before
# estate's year-long certificate, each act's runtime steps (wrapped secret
# ids, rotations, revocations), the stage reset to act 0, Raft health and
# snapshots, and the read-only checks of validate, verify and doctor.
# It may NOT create a mount or write a policy. It reads exactly one value:
# the LDAP bind password Vault rotated, to set it in Keycloak's federation
# (act 4; nothing else can carry it there).
# Written complete in prompt 02: after root revocation nothing can widen it.

# ── Secrets Sync: the GitHub App, destinations, associations, config ────────
path "sys/sync/github-apps" { capabilities = ["list", "sudo"] }
path "sys/sync/github-apps/*" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "sys/sync/destinations" { capabilities = ["list", "read", "sudo"] }
path "sys/sync/destinations/*" { capabilities = ["create", "read", "update", "delete", "list", "sudo"] }
path "sys/sync/associations" { capabilities = ["list", "read", "sudo"] }
path "sys/sync/associations/*" { capabilities = ["read", "list", "sudo"] }
path "sys/sync/config" { capabilities = ["read", "update", "sudo"] }
path "tidewell/sys/sync/github-apps" { capabilities = ["list", "sudo"] }
path "tidewell/sys/sync/github-apps/*" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "tidewell/sys/sync/destinations" { capabilities = ["list", "read", "sudo"] }
path "tidewell/sys/sync/destinations/*" { capabilities = ["create", "read", "update", "delete", "list", "sudo"] }
path "tidewell/sys/sync/associations" { capabilities = ["list", "read", "sudo"] }
path "tidewell/sys/sync/associations/*" { capabilities = ["read", "list", "sudo"] }

# ── Activation flags: Secrets Sync, Secrets Import (root namespace) ──────────
path "sys/activation-flags" { capabilities = ["read", "sudo"] }
path "sys/activation-flags/*" { capabilities = ["create", "read", "update", "sudo"] }

# ── KV: the story's paths (written by the waves and the reset) ───────────────
# Read on ci/ only: Secrets Sync refuses to associate a secret its caller
# cannot read (vault_sync, measured), and the act 1 wave associates it.
path "tidewell/kv/data/ops/*" { capabilities = ["create", "update", "delete"] }
path "tidewell/kv/data/ci/*" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/kv/data/canary/*" { capabilities = ["create", "update", "delete"] }
# The agent's permits (act 5): one per crossing and action, no secret value.
path "tidewell/kv/data/permits/*" { capabilities = ["create", "update", "delete"] }
path "tidewell/kv/metadata/permits/*" { capabilities = ["read", "delete", "list"] }
path "tidewell/kv/metadata/ops/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/kv/metadata/ci/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/kv/metadata/canary/*" { capabilities = ["read", "delete", "list"] }
path "tidewell/kv/metadata/ops" { capabilities = ["list"] }
path "tidewell/kv/metadata/ci" { capabilities = ["list"] }

# ── Database: the connection (carries the admin password), leases, reset ─────
path "tidewell/database/config/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/database/rotate-root/*" { capabilities = ["update"] }
path "tidewell/database/reset/*" { capabilities = ["update"] }
path "tidewell/sys/leases/lookup" { capabilities = ["update"] }
path "tidewell/sys/leases/lookup/*" { capabilities = ["list", "sudo"] }
path "tidewell/sys/leases/revoke" { capabilities = ["update"] }
path "tidewell/sys/leases/revoke-prefix/*" { capabilities = ["update", "sudo"] }

# ── AppRole: the app's wrapped single-use secret id (D9), and its cleanup ────
path "tidewell/auth/approle/role/+/role-id" { capabilities = ["read"] }
path "tidewell/auth/approle/role/+/secret-id" { capabilities = ["update", "list"] }
path "tidewell/auth/approle/role/+/secret-id-accessor/lookup" { capabilities = ["update"] }
path "tidewell/auth/approle/role/+/secret-id-accessor/destroy" { capabilities = ["update"] }
path "sys/wrapping/lookup" { capabilities = ["update"] }
path "tidewell/sys/wrapping/lookup" { capabilities = ["update"] }

# ── PKI: the CA ceremony (an intermediate whose key Vault generates, signed on
#    the host by the lab CA), the before estate's year-long certificate and
#    act 3's revocation ─────────────────────────────────────────────────────
path "tidewell/pki/intermediate/generate/internal" { capabilities = ["update"] }
path "tidewell/pki/intermediate/set-signed" { capabilities = ["update"] }
path "tidewell/pki/issuers" { capabilities = ["list", "read"] }
path "tidewell/pki/issuer/*" { capabilities = ["read"] }
path "tidewell/pki/issue/*" { capabilities = ["update"] }
path "tidewell/pki/revoke" { capabilities = ["update"] }
path "tidewell/pki/cert/*" { capabilities = ["read"] }
path "tidewell/pki/certs" { capabilities = ["list"] }
path "tidewell/pki/certs/revoked" { capabilities = ["list"] }
path "tidewell/pki/tidy" { capabilities = ["update"] }

# ── LDAP: the bind connection (carries the admin password), rotation ─────────
path "tidewell/ldap/config" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/ldap/rotate-root" { capabilities = ["update"] }
path "tidewell/ldap/rotate-role/*" { capabilities = ["update"] }
path "tidewell/ldap/static-cred/keycloak-bind" { capabilities = ["read"] }

# ── Transit: read the delegation key's public half (validate), never sign ───
path "tidewell/transit/keys/*" { capabilities = ["read"] }

# ── Agentic IAM: the agents' registrations (runtime) ─────────────────────────
path "tidewell/agent-registry/*" { capabilities = ["create", "read", "update", "delete", "list"] }

# ── Identity: read-only lookups for validate and the evidence ───────────────
path "tidewell/identity/entity/name/*" { capabilities = ["read"] }
path "tidewell/identity/entity/id/*" { capabilities = ["read"] }
path "tidewell/identity/lookup/entity" { capabilities = ["update"] }

# ── People: the console's fallback userpass users (if the probe needs them) ─
path "tidewell/auth/userpass/users" { capabilities = ["list"] }
path "tidewell/auth/userpass/users/saskia" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/auth/userpass/users/teun" { capabilities = ["create", "read", "update", "delete"] }

# ── Tokens from Terraform's roles (sudo: minting into a child namespace from
#    a root-namespace token needs it, measured in vault_governor) ──────────
path "tidewell/auth/token/create/vult-*" { capabilities = ["update", "sudo"] }
path "tidewell/auth/token/lookup" { capabilities = ["update"] }
path "tidewell/auth/token/lookup-accessor" { capabilities = ["update"] }
path "tidewell/auth/token/revoke-accessor" { capabilities = ["update"] }
path "tidewell/auth/token/roles/*" { capabilities = ["read"] }

# ── Cluster operations ───────────────────────────────────────────────────────
path "sys/storage/raft/configuration" { capabilities = ["read"] }
path "sys/storage/raft/snapshot" { capabilities = ["read"] }
path "sys/step-down" { capabilities = ["update", "sudo"] }
path "sys/license/status" { capabilities = ["read"] }
path "sys/health" { capabilities = ["read"] }
path "auth/token/lookup" { capabilities = ["update"] }

# ── Read-only checks (validate, verify, doctor) ──────────────────────────────
path "sys/audit" { capabilities = ["read", "sudo"] }
path "sys/namespaces" { capabilities = ["list"] }
path "sys/namespaces/tidewell" { capabilities = ["read"] }
path "tidewell/sys/mounts" { capabilities = ["read"] }
path "tidewell/sys/auth" { capabilities = ["read"] }
path "tidewell/sys/policies/acl/vult-*" { capabilities = ["read"] }

# Break glass (make root-regen): Vault 2.0 requires a token as well as the
# key share for sys/generate-root (HCSEC-2026-08). root-regen.sh sends this token.
path "sys/generate-root/*" { capabilities = ["create", "read", "update", "delete", "sudo"] }

# ── Never ────────────────────────────────────────────────────────────────────
path "tidewell/sys/mounts/*" { capabilities = ["deny"] }
path "sys/mounts/*" { capabilities = ["deny"] }
path "tidewell/sys/auth/*" { capabilities = ["deny"] }
path "tidewell/sys/policies/acl/*" { capabilities = ["deny"] }
path "sys/policies/acl/vult-*" { capabilities = ["deny"] }
path "tidewell/database/creds/*" { capabilities = ["deny"] }
