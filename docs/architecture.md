# Architecture

> **Terraform builds the house. Ansible decorates it. Vault keeps the keys.
> Make is the front door.**

## Topology

```text
network vult-internal (10.89.28.0/24)         TLS with the lab CA everywhere it matters
 ├─ seal:     vault-s (Shamir 1/1, Raft): the Transit key that unseals the cluster
 ├─ vault:    vault-1..3 (Raft, seal "transit"), audit file + stdout per node
 │            namespace tidewell/: kv, pki, jwt (people) from act 0;
 │            Sync + Import (act 1), database + approle (2), pki role booking (3),
 │            ldap (4), transit + OAuth profile + agent registry (5)
 ├─ identity: OpenLDAP (dc=tidewell,dc=lab), Keycloak 26.8 (realm tidewell,
 │            read-only LDAP federation, clients tidewell-console, -booking, -cli)
 ├─ data:     PostgreSQL 17 at .60 (TLS, SCRAM, the connection log in jsonlog)
 ├─ ai:       Ollama (llama3.2:3b), internal only
 ├─ cloud:    LocalStack at .50 (Secrets Manager)
 ├─ workload: booking (.70, HTTPS 14202), booking-agent (Vault Agent in
 │            booking's network namespace, from act 2), tide-agent (the AI agent)
 └─ app:      api (Node 24, not published),
              web (nginx, React, TLS 1.3 on 14201; /api and /auth to the API)
host:   runner/ (127.0.0.1:14209): make targets for the console, one at a time
        Terraform (vault-seal, vault-platform), Ansible, the witness container
outside: GitHub (raymonepping/vault_ultimate) through the VaultSyncDemo App
```

## Who does what

- **Terraform** declares structure, act by act (`var.act`, D10): mounts,
  roles, policies, auth methods, the OAuth profile, entities. `make tf-plan
  ACT=current` is empty at every act; `make tf-plan ACT=6` is what is left.
- **Ansible** carries what has a value or a moment: connections with their
  passwords, the wrapped secret id, rotations and pushes, the before estate,
  the waves (`ansible/act-N.yml`), the reset.
- **Vault** issues, renews, revokes and records; the audit log names who.
- **Make** is the front door: `make act-N` runs Terraform to act N, then the
  wave, then writes `.build/act` (last, so a failed wave leaves the old act).

## The booking app's credentials, act by act

```text
act 0  booking.env ── DB password (static, VALID UNTIL infinity)
       booking.env ── Keycloak client secret, agent key, deploy token
       year-long certificate (pki role booking-year)
act 2  Ansible ── wrapped secret id ──▶ Vault Agent ── AppRole login (once)
       Agent ── database/creds/booking (15 min, renewed) ──▶ /vault/out/db.json
       Agent ── kv ci/deploy-token ──▶ /vault/out/deploy.json
act 3  Agent ── pki/issue/booking (1 h) ──▶ /vault/out/tls/{key,cert}.pem
act 4  Keycloak ◀── mTLS with the site certificate (client-x509): no client secret
act 5  Agent API proxy on 127.0.0.1:8100 ── transit/sign/obo ──▶ at+jwt for the clerk
```

The app reads each file on change (polled fingerprints, in-place writes) and
swaps its database pool or TLS context without a restart.

## The console

```text
browser ── /auth/login ──▶ Keycloak (PKCE) ──▶ /auth/callback ──▶ api
api ── auth/jwt/login (Saskia's access token) ──▶ her Vault token, server side
api ── her token: revoke a listed lease, rotate the deploy token, read status
api ── runner (host.containers.internal:14209, bearer token) ──▶ make act-N,
       witness, timeline, tf-plan ACT=6, agent, stage-reset
api ── /build (the lab's records, read-only): witness, acts, act 6 timeline, plan
```

## The witness and the timeline

`make witness` runs `api/lib/witness.js` in a throwaway `vult-witness`
container on `vult-internal`; `make timeline` runs `api/lib/timeline.js` the
same way after `scripts/act6-collect.sh` gathered the drill's records. See
[evidence-model.md](evidence-model.md).

## Phases

`scripts/phases.txt` is the only phase list; `make lab` walks it, then the
gates: idempotency (every Ansible phase again, changed=0), drift (every
Terraform plan empty), secret scan, boundary. The acts are not phases: they
run on request, in order, and `make stage-reset` undoes them.
