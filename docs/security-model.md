# Security model

What protects what, and the check that proves it. Every boundary below is
enforced by Vault, GitHub or the operating system; the API never decides
access.

## Trust boundaries

| Boundary | Enforced by | Proved by |
| --- | --- | --- |
| No root token after bootstrap | init root revoked by Ansible | `make verify` (vault section) |
| Each tool token does its own job only (`tf-*`, `ansible-*`) | bootstrap policies; none may rewrite its own `vult-*` policy | `make boundary` (tool rows) |
| Saskia writes `kv/data/parcel/*`, reads only the one secret she syncs, moves only the two destinations' associations; never a destination's configuration, the GitHub App or a policy | `vult-presenter` (Terraform) | `make boundary` (14 rows), `ansible validate`, rehearsal N6 |
| Nobody syncs a secret they may not read | Vault (`associations/set` checks read on the secret) | rehearsal N6 ("permission denied to read the content of the secret") |
| Only Saskia signs in to the console; a step takes no parameters; writes from another site are refused | `api/lib/session.js`, `server.js` | rehearsal N2 to N5, `make test-ui` |
| The API never returns a value, token or key | values are fingerprinted in memory (`lib/localstack.js`), responses scrubbed (`lib/said.js`) | unit tests, rehearsal N7 (every answer and both logs), `make test-ui` |
| The API has no door of its own and holds no credential | not published; only nginx (TLS 1.3) reaches it; it mounts the lab CA and GitHub's evidence, read-only | `make verify` (app section) |
| A second import cannot overwrite the first | the API imports only paths KV does not hold (Import would write version 2) | rehearsal A1 |

## The GitHub App, not a token (D10)

Vault authenticates to GitHub with the VaultSyncDemo GitHub App: an App ID,
an installation on one repository, and a private key. No person's token is
involved, and the key cannot act outside the installation. The key stays in
`.secrets/github/` (0600, never committed) so a rebuild from nothing can
register it again; Vault checks its fingerprint against the file's on every
`make github-app` and reads it back as `*****`. `make github-forget-key
CONFIRM=yes` moves the file away; GitHub's App settings revoke a key.

Narrow the app's repository permissions in GitHub to Secrets (read and
write) and Metadata (read). Agent, Codespaces and Dependabot secrets are not
needed.

## The public repository

`raymonepping/vault_ultimate` is public. Repository Actions secrets stay hidden
on a public repository and are not given to workflows from forks; their
names and update times are visible to the repository's owner (`gh secret
list`). Every value the lab syncs is synthetic and says so (`demo` in the
legacy values, `tidewell-rotated-demo-<random>` for a rotation), so nothing of
value can leak through a name, a log or a mistake. `make stage-reset` and
`make clean-slate` remove every association first, so no `TIDEWELL_` secret
outlives the lab in GitHub.

## LocalStack's networking (D11)

The AWS destination holds synthetic keys (`test`), and its networking
allowlist names LocalStack's own address and port only:
`allowed_ipv4_addresses ["10.89.28.50/32"]`, `allowed_ports [4566]`.
Secrets Import has its own guard against private addresses; the import
config opens the same /32 (`allowed_ipv4_cidrs`) and nothing else. The Vault
nodes send every AWS call (STS too) to `https://localstack:4566` and verify
its certificate against the lab CA; no request leaves for real AWS.
LocalStack's auth token is in `.env` and handed to the LocalStack container
only (`make verify` checks the Vault nodes do not have it).

A limit, by design: LocalStack also listens on `127.0.0.1:14666` and accepts
the `test` keys from anyone, so the presenter can show the AWS side with
`lstk` (D4). Any process on this Mac can therefore read the legacy values and
the synced copies, or overwrite a copy; the console would then show "differs
from Vault" until the next sync. Real AWS would require IAM credentials and
a policy; on one Mac with synthetic values this is accepted.

## The audit log

Every step the console runs uses Saskia's own token and carries
`X-Correlation-Id`, so each event on the Proof page joins a request in
Vault's audit log, where the identity is Saskia. HMAC stays on.

## What is synthetic

Tidewell Ferries, Saskia Moreau, the three legacy secrets and their values, the
rotated values and LocalStack's keys are invented. Passwords, tokens and the
GitHub App's key are generated or provided per lab in `.secrets/` and never
committed.
