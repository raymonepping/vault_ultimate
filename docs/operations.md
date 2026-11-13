# Operations

Every operation is a `make` target; `make help` lists them all.

## Start, stop, check

| Situation | Command |
| --- | --- |
| First run | `make env-init`, put `VAULT_LICENSE` and `LOCALSTACK_AUTH_TOKEN` in `.env`, the GitHub App key in `.secrets/github/`, then `make license && make lab` |
| Daily start, or the Lab Index's Start | `make up` (`RUNTIME=podman` is accepted; anything else stops) |
| Stop, or the Lab Index's Stop | `make down` (containers stop, volumes stay) |
| Five minutes before a talk | `make show-ready` |
| After a rehearsal or a show | `make stage-reset CONFIRM=yes` |
| Something looks wrong | `make doctor` (read-only; names the fix) |
| What GitHub holds | `make github-evidence` (names and update times, never values) |
| Full check | `make verify` (includes `make rehearsal`), `make test-ui` |

`make up` installs the licence from `.env` when it is missing (or stops with
the instruction), runs `make lab` on a lab that was never built, and
otherwise brings back vault-s, vault-1..3, LocalStack and the app. It never
asks a question: the Lab Index runs it with stdin closed.

`make lab` from nothing (`make clean-slate CONFIRM=DELETE` first): 156 s on
2026-11-12 with the app images present, every gate green; `make down` 10 s,
`make up` 55 s. LocalStack keeps nothing across a restart on the free
licence: `make up` seeds the legacy store again and removes any AWS
association whose copy was lost (push it again from the console).

## Reset what a show changes

`make stage-reset CONFIRM=yes`: every association of `tidewell-github` and
`tidewell-localstack` is removed (Vault deletes the copies in GitHub and in
LocalStack), the imported `kv/parcel/*` paths are deleted with all their
versions, any legacy secret missing in LocalStack is created again, and the
API clears its event list. Vault's audit files are never edited.

## Tokens, keys and passwords

| What | File (0600) | Renewal |
| --- | --- | --- |
| Tool tokens `tf-*`, `ansible-*` | `.secrets/vault/tokens/` | periodic, renewed on every use |
| Seal tokens | `.secrets/vault/seal/vault-N` | `make seal-token-status`, `make seal-token-rotate NODE=` |
| Saskia's password | `.secrets/people/saskia` | created once; `make people-copy-password` copies, never prints |
| The VaultSyncDemo GitHub App key | `.secrets/github/*.pem` | kept so a rebuild registers the app again (D10); see below |
| LocalStack's auth token | `LOCALSTACK_AUTH_TOKEN` in `.env` | from your localstack.cloud account |

### The GitHub App key

`make github-app` (every `make lab`) registers the key in Vault and checks
that Vault's fingerprint equals the key's own. A rebuild from nothing
registers it again from `.secrets/github/`, so the file stays there.

`make github-forget-key CONFIRM=yes` moves it to `.secrets/legacy/<date>/`.
Vault keeps its registered copy and syncing goes on. A rebuild then stops
with: "generate a new private key for VaultSyncDemo in GitHub (App settings,
Private keys) and put it in .secrets/github/ (chmod 600), then make
github-app". A new key gets a new fingerprint, and `make github-app`
registers it.

## Bootstrap policies

`vault/policies/bootstrap/*.hcl` are written with the init root token, which
is then revoked. To change one: `make root-regen CLUSTER=vault`, then
`VULT_ROOT_FILE=.secrets/vault/root-vault scripts/ansible.sh bootstrap`, then
`make root-revoke CLUSTER=vault`, and record the use in `docs/STATE.md`. On a
young lab with nothing to keep, `make clean-slate` and `make lab` do the
same without a root token.

## Backup and starting over

- `make backup`: Raft snapshots of vault-s and the cluster and the secrets,
  into `backups/<time>/`.
- `make clean-slate` (type DELETE): first removes the story's associations
  (so no `TIDEWELL_` secret outlives the cluster in GitHub), then every
  `vult-` container and volume, and moves credentials to
  `.secrets/legacy/<time>/`; keeps the CA, the GitHub App key, the licence
  and the images. Then `make lab`.

## Measuring Vault again

`make probe` runs 39 cases in a scratch namespace on the 4h probe token that
bootstrap mints, and rewrites `docs/capabilities.md`. After four hours the
probe token is gone: re-mint it with the root-regen cycle above, or run it
right after a `make clean-slate CONFIRM=DELETE && make lab`.
