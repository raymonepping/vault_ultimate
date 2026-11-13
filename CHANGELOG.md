# Changelog

## 0.1.0 (2026-11-12)

- A seal Vault and a three-node Vault Enterprise 2.2.1 Raft cluster with
  Transit auto-unseal, scoped tool tokens and no root token after bootstrap.
- Namespace `tidewell`: KV v2, userpass, the presenter's policy; Secrets Sync
  and Secrets Import activated; two audit devices.
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
