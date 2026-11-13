# vault_ultimate: Bring Them Home, Send Them Out

Secrets Import and Secrets Sync on Vault Enterprise 2.2, on one Mac with
Podman. Vault pulls a company's legacy secrets out of an AWS-shaped store
(LocalStack), becomes their system of record, and pushes them out to GitHub
Actions and back to the AWS-shaped store, so one change in Vault lands
everywhere.

> **Terraform builds the house. Ansible decorates it. Vault keeps the keys.
> Make is the front door.**

![The two-way map: pulled into Vault, pushed out to GitHub Actions and the AWS copy](docs/screenshots/overview.png)

## What it proves, and what it only illustrates

**Proves:** `vault operator import` reads secrets from an AWS Secrets
Manager API and writes them to KV v2 with the source's tags as labels, after
a plan that writes nothing. Secrets Sync, set up in a child namespace,
pushes a KV secret to a GitHub repository through a GitHub App (no person's
token) and to AWS Secrets Manager. A new version reaches both within about a
second, and removing an association deletes the copy. The presenter's own
token does every step, so Vault's audit log names her. Every claim is
measured in [docs/capabilities.md](docs/capabilities.md) and checked again by
`make rehearsal`.

**Illustrates only:** LocalStack stands in for AWS Secrets Manager, with
synthetic keys; Tidewell Ferries, Saskia and every value are invented; one
presenter drives everything; one Mac is not production.

## The four acts

| Act | Page | What happens | Vault feature |
| --- | --- | --- | --- |
| Bring them home | Bring home | Plan, then import the three legacy secrets into `kv/parcel/` | Secrets Import |
| Send them out | Send out | Push `parcel/delivery-api` to GitHub Actions and to the AWS copy | Secrets Sync |
| Change once | Change once | Rotate the key in Vault; watch both copies follow | KV v2 + Secrets Sync |
| Let go | Send out | Remove an association; Vault deletes the copy | Secrets Sync |

The story: [docs/STORY.md](docs/STORY.md). A value is never on screen: the
console shows fingerprints (the first 8 hex of SHA-256).

## Prerequisites

- macOS on Apple Silicon, Podman 6 with a running machine (8 GiB or more).
  Disk: about 2.6 GB (measured 2026-11-12: vault-enterprise 571 MB,
  localstack 1.2 GB, the API 131 MB on top of the Vault image, web 63 MB,
  node, nginx and alpine 242 MB, the volumes about 250 MB), plus
  Playwright's Chromium for `make test-ui`.
- Terraform 1.14, ansible-core 2.21, Node 24 or later, `jq`, `openssl`,
  `shellcheck` (for `make lint`), and the `gh` CLI signed in
  (`gh auth status`) for `make github-evidence`.
- A Vault Enterprise licence with Secrets Sync, Secrets Import and
  Namespaces: `VAULT_LICENSE` in `.env`.
- A free LocalStack account: its auth token as `LOCALSTACK_AUTH_TOKEN` in
  `.env`. LocalStack keeps nothing across a restart on the free licence;
  `make up` seeds it again.
- A GitHub App with Actions secrets read and write on one repository: its
  App ID and installation ID in `config/defaults.conf` (`make
  github-installation` prints the installation ID once the key is in place),
  its private key in `.secrets/github/` (0600). The secrets it writes are named `TIDEWELL_*`.

## First run

```bash
make env-init          # .env from .env.example; put VAULT_LICENSE and LOCALSTACK_AUTH_TOKEN in it
make license           # installs the licence to .secrets/vault/vault.hclic, never printed
make lab               # every phase, then the gates (about two and a half minutes)
make people-copy-password   # Saskia's password on the clipboard, never printed
```

Then open the console at <https://localhost:14201/> and sign in as `saskia`.
The lab CA is in no browser's trust store: `make trust-root` adds it to the
macOS keychain (sudo), or accept the warning.

`make up` on a lab that was never built runs `make lab` itself, so the
Lab Index (vault_lab_index) Start button works from nothing.

## Daily

```bash
make up                # or the Lab Index's Start: everything back, volumes kept (55 s)
make down              # or its Stop: every container stops, every volume stays (10 s)
make show-ready        # five minutes before a talk: up, fresh stage, verify
make github-evidence   # what GitHub itself says (names and update times) for the console
make stage-reset CONFIRM=yes   # nothing synced (copies deleted), nothing imported
make doctor            # what is wrong, and which command fixes it
```

## Checks

| Command | What it proves |
| --- | --- |
| `make verify` | 77 checks: the cluster, the platform, the stage, LocalStack, the app, the console, the token boundary, drift, idempotency, a secret scan and `make rehearsal` |
| `make rehearsal` | 47 checks through the console: the four acts against Vault, LocalStack and GitHub, and every way they must fail |
| `make boundary` | 50 checks: each tool token and Saskia may do their job and nothing else |
| `make test-ui` | 22 Playwright tests: the four acts from the UI, axe WCAG 2.1 AA on every page (desktop and phone), TLS and CSP |
| `make probe` | 39 cases in a scratch namespace: what Vault 2.2.1 Secrets Sync and Secrets Import actually do |
| `make test-unit`, `make lint` | unit tests (33) and static checks, no stack needed |

## Ports (127.0.0.1)

| Service | Address |
| --- | --- |
| Console | <https://localhost:14201/> |
| API (behind the console) | <https://localhost:14201/api/healthz> |
| vault-1 to vault-3 | <https://localhost:19701/ui>, 19702, 19703 |
| vault-s (the seal Vault) | <https://localhost:19700> |
| LocalStack (AWS API) | <https://localhost:14666> |

The API answers only behind the console's TLS. Every container, compose
project and volume carries the prefix `vult-`.

## Where things are

- `Makefile`, `scripts/`: every operation; `scripts/phases.txt` is the only
  phase list.
- `terraform/vault-seal`, `terraform/vault-platform`: the declared structure
  (namespace `tidewell`, KV, userpass, the presenter's policy, audit devices).
- `ansible/`: order and moment (init, tokens, the GitHub App, both sync
  destinations, the legacy store, the presenter, the stage, validate).
- `config/story.json` (the legacy secrets, what syncs, what rotates),
  `config/defaults.conf`.
- `vault/`: server HCL and bootstrap policies. `compose/`: the stacks.
- `api/` (Node 24, no dependencies, on the Vault Enterprise image for
  `vault operator import`), `web/` (React 19 + Vite, Vault daylight glass),
  `e2e/` (Playwright).
- Docs: [architecture](docs/architecture.md), [operations](docs/operations.md),
  [security model](docs/security-model.md), [ownership](docs/ownership.md),
  [capabilities](docs/capabilities.md), [design](DESIGN.md),
  [state](docs/STATE.md).

## Licence

[GPL-3.0](LICENSE).
