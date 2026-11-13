# Operations

Every operation is a `make` target; `make help` lists them all.

## Start, stop, check

| When | Run |
| --- | --- |
| First run | `make env-init`, put `VAULT_LICENSE` and `LOCALSTACK_AUTH_TOKEN` in `.env`, then `make license && make gen-certs && make trust-root && make lab` |
| Daily start, or the Lab Index's Start | `make up` (`RUNTIME=podman` is accepted; anything else stops) |
| Stop, or the Lab Index's Stop | `make down` (every stack and the host runner stop; volumes stay) |
| After the Mac slept | `make wake-up` |
| Five minutes before a talk | `make show-ready` |
| After a rehearsal or a show | `make stage-reset CONFIRM=yes` |
| Something looks wrong | `make doctor` (read-only; names the fix) |
| Full check | `make verify` (includes `make rehearsal`), then `make test-ui` |

`make up` installs the licence from `.env` when it is missing (or stops with
the instruction), runs `make lab` on a lab that was never built, and
otherwise starts each stack from the bottom, saying what it kept and what it
started. It never asks a question and never touches a volume.

## After the Mac slept: `make wake-up` (D16)

It measures the VM's clock against the Mac's (and syncs it when they differ
by more than 2 s), restarts any exited or unhealthy `vult-` service through
its compose stack (never a one-shot init container), waits until every Vault
node is unsealed and the cluster has a leader, and from act 2 gives the
booking app's Vault Agent a fresh secret id when Agent is gone, unhealthy, or
the app is off its lease. One screen says what it found and what it fixed;
when nothing was wrong it changes nothing. The decision is
`scripts/wake-decide.js`, unit-tested.

## Vault Agent must log in again

Agent keeps its token in a tmpfs and its secret id is single use, so a
stopped or recreated Agent cannot log in on its own. `make agent` (from act
2) delivers a fresh response-wrapped secret id and restarts Agent with the
configuration of the current act; `make up`, `make wake-up` and
`make workload-up` do it when they must. A revoked lease also stays dead in
Agent's template until its next renewal (about two thirds of the TTL), so the
act 6 drill and the console's "Agent logs in again" do the same.

## The reset: `make stage-reset CONFIRM=yes` (D17)

Back to act 0 on purpose, in reverse: the agent's registration and permits
go and the schedule is reloaded; the old bind password returns to OpenLDAP
and Keycloak and the booking client to its secret; the app goes back to
`booking.env` before Terraform unmounts `database/` (which revokes every
lease; the revocation statements end their sessions); Sync's associations and
act 1's KV paths go; Terraform to `ACT=0`; `before-estate` and `canary` with
`VULT_RESET=1` (a new year-long certificate, the legacy store, the hand-made
copies, the act 0 note). The witness history and act 6's records are
archived under `.build/witness/archive/`, and the reset ends with a witness
run that must count the act 0 baseline (6 standing, 6 unmanaged).

## LocalStack after a restart

The free LocalStack keeps nothing. `make up` notices a LocalStack that
started: at act 0 it runs `before-estate` (the legacy store and the
hand-made copy), from act 1 `reconcile-localstack` (the AWS association
removed and set again, so Sync writes the copy back).

## A rebuild from nothing

`make clean-slate CONFIRM=DELETE` removes every `vult-` container and volume
except `vult-ollama_models`, and moves `.secrets/` aside (credentials are
never deleted); `make lab` builds everything again, then the gates.
`make clean-models CONFIRM=yes` removes the models volume too (the next
`make lab` pulls about 5.5 GB).

## The disk gate (D20)

`make disk-check` is read-only. A pull needs 20 GiB free on the Mac, a build
on local base images 12 GiB; below 8 GiB even `make lab` stops. The lab never
prunes: reclaiming space is the operator's call (`Personal/docker_inventory`:
a reviewed ledger, exact-name orphan removal, then `fstrim`).

## Tokens, keys and passwords

| What | Where | Rotate or replace |
| --- | --- | --- |
| Scoped tool tokens | `.secrets/vault/tokens/` | periodic; renewed on use |
| Seal tokens | `.secrets/vault/seal/vault-N` | `make seal-token-status`, `make seal-token-rotate NODE=` |
| People's passwords (Saskia, Teun) | `.secrets/people/`, `.secrets/identity/users/` | created once; `make people-copy-password` copies, never prints |
| The before estate's secrets | `.secrets/workload/`, `.secrets/identity/` | create-only: the reset puts the same values back on purpose |
| The host runner's token | `.build/run/runner.token` | a new one on every runner start |
| The GitHub App key | `.secrets/github/` | copied by path from `../vault_sync/.secrets/github/` (`make github-key`) |

## Bootstrap policies

The four scoped tokens' policies are written at bootstrap with the root
token, which is then revoked. To change one: `make root-regen CLUSTER=vault`,
apply, `make root-revoke CLUSTER=vault`, and record the use in
`docs/STATE.md`; on a young lab with nothing to keep, `make clean-slate` and
`make lab` do the same.

## Budget (D20)

`make up` from stopped under 90 s; `make lab` from nothing under 5 minutes.
The measured times are in `docs/STATE.md` (prompt 10).
