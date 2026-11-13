# vult-tf-platform: Terraform root vault-platform on the cluster (D5 to D7,
# D10). Declared, plannable, act-aware structure: audit devices (root
# namespace), the namespace tidewell and, inside it, the mounts, auth
# methods, roles, identity groups, the Agentic IAM profile and the vult-*
# ACL policies. It holds no credential and no story state: no secret read, no
# database or LDAP connection (they carry passwords: Ansible's), no lease, no
# certificate issued, no sync destination, no token.
# Written complete in prompt 02: after root revocation nothing can widen it.
# A root-namespace token reaches tidewell through tidewell/-prefixed paths.

# ── Audit, root namespace (sudo: Vault requires it) ──────────────────────────
path "sys/audit" { capabilities = ["read", "sudo"] }
path "sys/audit/file" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "sys/audit/stdout" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "sys/config/auditing/request-headers" { capabilities = ["read", "sudo"] }
path "sys/config/auditing/request-headers/*" { capabilities = ["create", "read", "update", "delete", "sudo"] }

# ── The namespace ────────────────────────────────────────────────────────────
path "sys/namespaces" { capabilities = ["list"] }
path "sys/namespaces/tidewell" { capabilities = ["create", "read", "update", "delete"] }

# ── Secret engines in tidewell, by name (enable, read and tune) ──────────────
path "tidewell/sys/mounts" { capabilities = ["read"] }
path "tidewell/sys/mounts/kv" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/sys/mounts/database" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/sys/mounts/pki" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/sys/mounts/ldap" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/sys/mounts/transit" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/sys/mounts/kv/tune" { capabilities = ["read", "update"] }
path "tidewell/sys/mounts/database/tune" { capabilities = ["read", "update"] }
path "tidewell/sys/mounts/pki/tune" { capabilities = ["read", "update"] }
path "tidewell/sys/mounts/ldap/tune" { capabilities = ["read", "update"] }
path "tidewell/sys/mounts/transit/tune" { capabilities = ["read", "update"] }
path "tidewell/kv/config" { capabilities = ["create", "read", "update"] }

# ── Engine structure: roles and configuration that hold no credential ────────
path "tidewell/database/roles/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/database/roles" { capabilities = ["list"] }
path "tidewell/ldap/static-role/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/ldap/static-role" { capabilities = ["list"] }
# Transit: the booking app's delegation-signing key (act 5, probe P31b). The
# key never leaves Vault (exportable = false); Terraform reads its public half
# for the OAuth profile and never signs.
path "tidewell/transit/keys/*" { capabilities = ["create", "read", "update"] }
path "tidewell/transit/keys" { capabilities = ["list"] }
# PKI: the CA, issuers, roles, URLs, CRL and OCSP configuration. Issuing,
# signing and revoking certificates is runtime (denied below).
path "tidewell/pki/root/*" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/pki/issuer/*" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/pki/issuers" { capabilities = ["list", "read"] }
path "tidewell/pki/issuers/*" { capabilities = ["create", "read", "update"] }
path "tidewell/pki/key/*" { capabilities = ["read", "update"] }
path "tidewell/pki/keys" { capabilities = ["list"] }
path "tidewell/pki/roles/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/pki/roles" { capabilities = ["list"] }
path "tidewell/pki/config/*" { capabilities = ["create", "read", "update", "delete"] }

# ── Auth methods in tidewell (enable, read and tune need sudo) ───────────────
path "tidewell/sys/auth" { capabilities = ["read"] }
path "tidewell/sys/auth/approle" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "tidewell/sys/auth/oidc" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "tidewell/sys/auth/jwt" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "tidewell/sys/auth/userpass" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "tidewell/sys/auth/+/tune" { capabilities = ["read", "update", "sudo"] }
path "tidewell/sys/mounts/auth/+" { capabilities = ["read"] }
path "tidewell/sys/mounts/auth/+/tune" { capabilities = ["read", "update", "sudo"] }
path "tidewell/sys/auth/token" { capabilities = ["read"] }
path "tidewell/auth/approle/role/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/auth/approle/role" { capabilities = ["list"] }
path "tidewell/auth/oidc/config" { capabilities = ["create", "read", "update"] }
path "tidewell/auth/oidc/role/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/auth/jwt/config" { capabilities = ["create", "read", "update"] }
path "tidewell/auth/jwt/role/*" { capabilities = ["create", "read", "update", "delete", "list"] }

# ── Identity: groups for Keycloak's groups, entities, the token issuer ───────
path "tidewell/identity/entity" { capabilities = ["create", "update"] }
path "tidewell/identity/entity/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/identity/entity-alias" { capabilities = ["create", "update"] }
path "tidewell/identity/entity-alias/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/identity/group" { capabilities = ["create", "update"] }
path "tidewell/identity/group/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/identity/group-alias" { capabilities = ["create", "update"] }
path "tidewell/identity/group-alias/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/identity/lookup/*" { capabilities = ["update"] }
path "tidewell/identity/oidc/key/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/identity/oidc/role/*" { capabilities = ["create", "read", "update", "delete", "list"] }
path "tidewell/identity/oidc/config" { capabilities = ["read", "update"] }

# ── Agentic IAM (sys/config/* needs sudo, also to read: vault_identity) ──────
path "tidewell/sys/config/oauth-resource-server" { capabilities = ["read", "list", "sudo"] }
path "tidewell/sys/config/oauth-resource-server/*" { capabilities = ["create", "read", "update", "delete", "list", "sudo"] }
path "tidewell/agent-registry/*" { capabilities = ["create", "read", "update", "delete", "list"] }

# ── Token roles and policies: the lab's vult-* only ──────────────────────────
path "tidewell/auth/token/roles" { capabilities = ["list"] }
path "tidewell/auth/token/roles/vult-*" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/sys/policies/acl" { capabilities = ["list"] }
path "tidewell/sys/policies/acl/vult-*" { capabilities = ["create", "read", "update", "delete"] }
path "tidewell/sys/policy/vult-*" { capabilities = ["create", "read", "update", "delete"] }

# ── The provider ─────────────────────────────────────────────────────────────
path "auth/token/create" { capabilities = ["update"] }
path "auth/token/lookup-self" { capabilities = ["read"] }
path "sys/license/status" { capabilities = ["read"] }

# ── Never: values, credentials, leases, certificates, sync, own policies ─────
path "tidewell/kv/data/*" { capabilities = ["deny"] }
path "tidewell/kv/metadata/*" { capabilities = ["deny"] }
path "tidewell/database/config/*" { capabilities = ["deny"] }
path "tidewell/database/creds/*" { capabilities = ["deny"] }
path "tidewell/database/rotate-root/*" { capabilities = ["deny"] }
path "tidewell/ldap/config" { capabilities = ["deny"] }
path "tidewell/ldap/static-cred/*" { capabilities = ["deny"] }
path "tidewell/ldap/rotate-role/*" { capabilities = ["deny"] }
path "tidewell/pki/issue/*" { capabilities = ["deny"] }
path "tidewell/pki/sign/*" { capabilities = ["deny"] }
path "tidewell/pki/revoke" { capabilities = ["deny"] }
path "tidewell/transit/sign/*" { capabilities = ["deny"] }
path "tidewell/transit/export/*" { capabilities = ["deny"] }
path "tidewell/transit/keys/+/config" { capabilities = ["deny"] }
path "tidewell/auth/approle/role/+/secret-id" { capabilities = ["deny"] }
path "tidewell/auth/approle/role/+/secret-id/*" { capabilities = ["deny"] }
path "tidewell/auth/userpass/users/*" { capabilities = ["deny"] }
path "tidewell/auth/token/create/*" { capabilities = ["deny"] }
path "tidewell/sys/leases/*" { capabilities = ["deny"] }
path "sys/sync/*" { capabilities = ["deny"] }
path "tidewell/sys/sync/*" { capabilities = ["deny"] }
path "sys/policies/acl/vult-*" { capabilities = ["deny"] }
