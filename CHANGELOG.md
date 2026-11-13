# Changelog

## 1.0.0 (2026-11-13)

Zero Standing Secrets: the lab rebuilt around Tidewell Ferries' booking app.

- The before estate (act 0): a plain booking app (Node 24, PostgreSQL 17),
  an AI agent with a static key, OpenLDAP and Keycloak 26.8, a year-long
  certificate from Vault PKI, a deploy token pasted into GitHub and
  LocalStack, the legacy secrets in LocalStack.
- Six acts, each a Terraform declaration (`var.act`) and an Ansible wave:
  Secrets Import and Sync take over the copies (1); a response-wrapped,
  single-use AppRole secret id and Vault Agent's 15-minute lease (2);
  one-hour certificates and the year-long one revoked (3); the LDAP engine
  rotates Keycloak's bind password and Keycloak takes a Vault certificate
  instead of a client secret (4); Agentic IAM delegation signed by a
  non-exportable Transit key, with the agent's ceiling (5); the revocation
  drill with a timeline from the systems' own records (6).
- The witness (a real try per credential, answers verbatim, unknown when a
  target does not answer) and the scoreboard (standing secrets, longest
  lifetime, unmanaged copies, the leak window, each with its evidence).
- `make stage-reset` back to act 0 on purpose, proven by the witness.
- The console: Saskia signs in through Keycloak; the act rail, the witness,
  the investigation, the proof; a host runner for the waves.
- `make rehearsal`, `make verify`, `make test-ui` (axe at two viewports),
  `make wake-up`, a rewritten `make up`, `down`, `doctor`.

## 0.1.0 (2026-11-12)

- A seal Vault and a three-node Vault Enterprise 2.2.1 Raft cluster with
  Transit auto-unseal, scoped tool tokens and no root token after bootstrap.
- Namespace `tidewell`: KV v2, userpass, the presenter's policy; Secrets Sync
  and Secrets Import activated; two audit devices. (From the vault_sync
  skeleton this lab started from.)
- LocalStack 2026.10.6 as the AWS-shaped store, over HTTPS with the lab
  certificate, at a fixed address the sync destination's allowlist names
  (/32, port 4566).
- Secrets Import from LocalStack into `kv/parcel/` (run by the API as the
  presenter, one mapping per legacy secret, never twice); Secrets Sync to
  GitHub Actions through the VaultSyncDemo GitHub App and to LocalStack.
- The Tidewell Ferries console (Node 24 API without dependencies on the Vault
  Enterprise image, React 19, Vault daylight glass): the two-way map, the
  four acts, fingerprints instead of values, GitHub's own record with its age.
- `make probe` (39 cases), `make rehearsal` (47), `make verify` (77),
  `make boundary` (50), `make test-ui` (22 with axe), 33 unit tests.
- `make up` and `make down` work from the Lab Index (`RUNTIME=podman`); `make
  up` builds the lab on its first run and re-seeds LocalStack after a
  restart.
