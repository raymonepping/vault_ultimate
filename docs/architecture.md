# Architecture

> **Terraform builds the house. Ansible decorates it. Vault keeps the keys.
> Make is the front door.**

## Topology

```text
network vult-internal (10.89.28.0/24)          every listener: TLS 1.3, lab CA
 ├─ seal:  vault-s (Shamir 1/1, Raft): Transit key for auto-unseal
 ├─ vault: vault-1..3 (Raft, seal "transit"), audit file + stdout per node
 │         AWS_ENDPOINT_URL=https://localstack:4566, SSL_CERT_DIR with the lab CA
 │         namespace tidewell/: kv/ (v2), userpass/, vult-presenter,
 │           GitHub App vaultsyncdemo, destinations tidewell-github (gh) and
 │           tidewell-localstack (aws-sm); Secrets Sync and Import activated
 ├─ cloud: localstack 2026.10.6 at 10.89.28.50 (Secrets Manager, HTTPS with
 │         the lab certificate); host port 14666
 ├─ app:   api (Node 24 on the Vault Enterprise image, not published)
 │         web (nginx + React, TLS :14201, proxies /api)
 ├─ Terraform: vault-seal (tf-seal) │ vault-platform (tf-platform)
 └─ Ansible:   localhost → Vault and LocalStack HTTPS APIs (ansible-seal,
               ansible-platform)
outside: GitHub (raymonepping/vault_ultimate) through the VaultSyncDemo GitHub App;
         the host's gh CLI reads its secret names for make github-evidence
```

## The two directions

```text
              PULL (Secrets Import)                 PUSH (Secrets Sync)
 LocalStack ──────────────────────▶ Vault kv/parcel ──────────────────▶ GitHub Actions
 tidewell-legacy/*   vault operator         (system      associations      TIDEWELL_PARCEL_..._VALUE
                  import, run by the     of record)   set / remove
                  API as Saskia                        ─────────────────▶ LocalStack
                                                                        vault/tidewell/parcel/*
```

1. **Pull.** The API writes an import config from `config/story.json` (one
   mapping per legacy secret that KV does not hold yet, LocalStack's /32 in
   `allowed_ipv4_cidrs`) to its tmpfs and runs `vault operator import
   -config=... [plan|-auto-approve apply]` with Saskia's token in the child's
   environment. Import reads Secrets Manager through `AWS_ENDPOINT_URL` and
   writes metadata, then data. It does not parse a JSON `SecretString`, so
   the legacy values are plain strings (D19). The CLI exits 0 even when a
   write was refused; the API reads its "Secrets not imported" list instead.
2. **Push.** `associations/set` on a destination in `tidewell` makes Vault
   write the secret there and keep it current: on GitHub as a repository
   Actions secret named by `TIDEWELL_{{ .SecretPath | uppercase }}_{{
   .SecretKey | uppercase }}` (secret-key granularity; Vault turns `/` and `-`
   into `_`), in LocalStack as `vault/tidewell/<path>` holding `{"value": ...}`
   (secret-path granularity). `associations/remove` deletes the copy.
   `associations/set` needs read on the secret: Saskia may read exactly the
   one secret the story syncs.
3. **Evidence.** The console reads Vault (KV metadata, sync status) and
   LocalStack (names, tags, value fingerprints computed in memory) as Saskia,
   and GitHub's own record from `.build/github/evidence.json`, which `make
   github-evidence` writes on the host with `gh secret list`. Evidence read
   before Vault's last sync of a secret shows as stale.

## Phases

`scripts/phases.txt` is the only list: seal-up, seal-init, vault-seal,
seal-tokens, vault-up, bootstrap, cloud-up, vault-platform, people,
github-app, destinations, seed, stage, app-up, validate. `make lab` walks it,
then the gates: idempotency, drift, secret-scan, boundary.

## The API

| Route | Does |
| --- | --- |
| `POST /api/session`, `/api/session/end`, `GET /api/session` | sign in as `saskia` (userpass), sign out (revokes her token) |
| `GET /api/story` | the acts, the legacy secrets by name, the busy step |
| `POST /api/acts/:act/:step` | one step: `home/plan`, `home/apply`, `out/github`, `out/localstack`, `change/rotate`, `letgo/github`, `letgo/localstack`; empty body only |
| `GET /api/sync` | both destinations and their associations, as Vault reports them |
| `GET /api/sources` | each secret in the legacy store, Vault, the AWS copy and GitHub, by fingerprint |
| `GET /api/events` | the last 200 steps (in memory), each with a correlation id |
| `GET /api/status`, `GET /api/healthz` | nodes, LocalStack, the evidence file; the process |

One step runs at a time (409 while another runs). Every Vault call carries
`X-Correlation-Id: vult-<uuid>`, which the audit log records.
