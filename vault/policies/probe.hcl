# vult-probe: prompt 03's scratch probe (make probe). Minted by Ansible
# (bootstrap) with a 4h TTL before root is revoked (docs/STATE.md). It works
# in scratch namespaces probe-<epoch> and on root-namespace sync objects whose
# names start with probe- (destinations, GitHub App registrations). Every one
# is deleted at the end of each run. It has no path in tidewell.

path "sys/namespaces" { capabilities = ["list"] }
path "sys/namespaces/probe-*" { capabilities = ["create", "read", "update", "delete"] }
# Everything inside a scratch namespace (mounts, auth, policies, KV, sync).
path "probe-*" { capabilities = ["create", "read", "update", "delete", "list", "patch", "sudo"] }

# Root-namespace sync objects named probe-* (and the lists to find them).
path "sys/sync/github-apps" { capabilities = ["list", "sudo"] }
path "sys/sync/github-apps/probe-*" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "sys/sync/destinations" { capabilities = ["list", "read", "sudo"] }
path "sys/sync/destinations/+/probe-*" { capabilities = ["create", "read", "update", "delete", "list", "sudo"] }
path "sys/sync/destinations/+/probe-*/*" { capabilities = ["create", "read", "update", "delete", "list", "sudo"] }
path "sys/sync/associations" { capabilities = ["list", "read", "sudo"] }
path "sys/sync/config" { capabilities = ["read", "sudo"] }
# A root-namespace KV for the root-namespace sync test (probe-kv only).
path "sys/mounts/probe-kv" { capabilities = ["create", "read", "update", "delete", "sudo"] }
path "probe-kv/*" { capabilities = ["create", "read", "update", "delete", "list"] }

# Secrets Import's activation flag.
path "sys/activation-flags" { capabilities = ["read", "sudo"] }
path "sys/activation-flags/*" { capabilities = ["create", "read", "update", "sudo"] }

path "sys/license/status" { capabilities = ["read"] }
path "sys/storage/raft/configuration" { capabilities = ["read"] }
path "auth/token/lookup-self" { capabilities = ["read"] }

path "tidewell/*" { capabilities = ["deny"] }
path "sys/namespaces/tidewell" { capabilities = ["deny"] }
path "sys/policies/acl/vult-*" { capabilities = ["deny"] }
