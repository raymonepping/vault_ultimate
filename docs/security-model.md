# Security model

What protects what, and the check that proves it. Every boundary below is
enforced by Vault, Keycloak, PostgreSQL, OpenLDAP or the operating system;
the console never decides access on its own.

## Trust boundaries

| Boundary | Enforced by | Proved by |
| --- | --- | --- |
| No root token after bootstrap; four scoped tool tokens (`tf-seal`, `ansible-seal`, `tf-platform`, `ansible-platform`), none may rewrite its own `vult-*` policy | bootstrap policies (`vault/policies/bootstrap/`) | `make boundary`, `make verify` (vault) |
| Terraform declares, Ansible carries values: Terraform's token is denied every connection password, secret id, issued certificate, static credential and `transit/keys/*/config` | `vult-tf-platform` | `make boundary` |
| Saskia may revoke a booking lease and rotate the deploy token; she may not read a legacy value, mint the app's secret id or take a database credential | `vult-presenter` (through the external group `platform`) | `ansible validate` (capabilities-self), rehearsal |
| Only Saskia gets a console session: Keycloak's code flow with PKCE, then Vault's jwt login; any other token is revoked at once | `api/lib/oidc.js`, `api/lib/session.js` | API tests, `make test-ui` |
| An action takes no parameters; acts run in order only; only a lease the console listed can be revoked; the reset needs a single-use confirmation; writes from another site are refused | `api/lib/console.js`, `server.js` | API tests, rehearsal negatives, `make test-ui` |
| No value, token or key in an API answer, an event or a log line | events scrubbed and redacted on the way in (`lib/events.js`); the request log names routes only | rehearsal (every answer, five containers' logs, the witness history, the timeline) |
| The host runner runs allowlisted make targets only, one at a time, for a caller with its token; browsers are refused | `runner/` (loopback, bearer token per start, Origin refused) | runner tests, `make verify` |
| The app's database credential is a lease; its revocation ends open sessions | the role's revocation statements start with `pg_terminate_backend` (probe Q2) | act 6: session gone in under a second |
| The app's secret zero is single use | response wrapping (60 s), `secret_id_num_uses = 1`, bound to the booking container's /32 (D9) | the witness: `400 wrapping token is not valid or does not exist` |
| The agent acts only inside its ceiling, whatever the clerk delegates | Agentic IAM: the agent registry's ceiling `vult-agent-ceiling` (rebook only), the token's RAR names one permit | act 5: `CEILING_POLICY_DENIED` |
| No signing key outside Vault | Transit key `obo` is not exportable; the booking app signs through Vault Agent's API proxy | `make boundary` (Terraform may not change key config) |

## Secret zero, and what Ansible stands in for (D9)

The booking app's first credential is a response-wrapped, single-use AppRole
secret id that Ansible, the trusted orchestrator, delivers into the Agent's
input volume; Agent unwraps it and logs in once. Every later Agent login
(act 3's template, act 5's proxy, act 6's drill, `make wake-up`) is a new
delivery: a used secret id never works again. In production the platform
itself vouches for the workload (Kubernetes service accounts, cloud
instance identity, SPIFFE); Ansible stands in for that here.

## Residuals

A credential the lab cannot remove stays in the inventory, counted and
explained, never hidden:

- **The CI deploy token.** GitHub's hosted runners cannot reach this lab's
  Vault, so the token stays static. Secrets Sync keeps every copy current and
  act 6 rotates it once; the witness then reports the old value refused and
  the current one standing. Production removes it with GitHub Actions OIDC
  to Vault's JWT auth.

## LocalStack is a place, not a credential test (D12)

LocalStack accepts any access key (probe Q9: an access key that was never
issued gets HTTP 200), so no AWS key is in the inventory. LocalStack holds
the before estate's legacy secrets and the hand-made deploy-token copy, and
from act 1 Vault's synced copy. The Vault nodes send every AWS call to
`https://localstack:4566` with the lab CA; Sync's destination allows
LocalStack's /32 and port 4566 only. LocalStack also listens on
`127.0.0.1:14666` and accepts the `test` keys from anyone on this Mac:
accepted, with synthetic values.

## Ollama

`vult-ollama` has no authentication. It is on `vult-internal` only, never
published, capped at 4 CPUs and 6 GiB, `OLLAMA_NO_CLOUD=1`. The agent maps a
clerk's words onto an allowlisted action and the crossing ids it was shown;
anything else is refused before an API call. The summary sees timeline rows
only, and only sentences that cite real rows are kept. Nothing the model
says moves a credential or decides access.

## Keycloak and the booking client

From act 4 Keycloak authenticates the booking client by its certificate
(`client-x509`, subject `CN=booking`): the site's own one-hour certificate
from Vault PKI, over mutual TLS. Keycloak runs with
`KC_HTTPS_CLIENT_AUTH=request` (it asks for a client certificate, never
requires one) and the lab CA as its truststore. The lab-only client
`tidewell-cli` (password grant) exists for scripted sign-ins and tests.

## Accepted limits on the internal network

Recorded decisions, each with what production does instead:

- **LDAP without TLS.** Keycloak's federation, Vault's LDAP secrets engine
  and the witness bind to OpenLDAP over `ldap://openldap:389` on
  `vult-internal`; bind passwords cross that network in clear. Only this
  lab's containers are on it. Production uses LDAPS (or StartTLS) with the
  directory's certificate. Passwords never appear on a command line: the
  LDAP tools read them from files (`-y`, `-T`).
- **tide-agent answers anyone on `vult-internal`.** Before act 5 it acts
  with its own static key for whoever asks: that is the before estate's
  problem the story shows. From act 5 it holds no credential and acts only
  with the delegation token the booking app sends.
- **The booking app's `/healthz` names its current lease id.** A lease id is
  an identifier, not a credential: revoking needs a token with
  `sys/leases/revoke` rights (Saskia's, scoped to this role's leases). The
  console lists it from there so only that lease can be revoked.

## The public repository

`raymonepping/vault_ultimate` is public. Every value the lab writes to GitHub
is synthetic and generated per lab; the only GitHub objects the lab writes
are Actions secrets. `.env`, `.secrets/`, `.build/`, `booking.env`,
`prompts/`, `input/`, `article/` and the agent folders are never committed;
gitleaks and IBM's Block Secrets scan every commit, and the OCSP tests make
their certificates at test time rather than commit any.

## The audit log

Every console action that touches Vault uses Saskia's own token and carries
`X-Correlation-Id`, so each event on the Proof page joins a request in
Vault's audit log that names her. HMAC stays on. A lease expiry writes no
audit entry: the timeline labels expiry rows derived.

## What is synthetic

Tidewell Ferries, Saskia, Teun, the passengers, the manifest, the legacy
secrets, the permits and LocalStack's keys are invented. Passwords, tokens
and keys are generated per lab into `.secrets/` (0600) and never printed or
committed; the console shows fingerprints only.
