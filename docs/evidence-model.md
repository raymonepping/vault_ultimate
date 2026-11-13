# Evidence model

Every number and every sentence the console shows rests on a record a system
made itself. This page says which records, how they are read, and the rules
that keep the numbers honest.

## The witness

`api/lib/witness.js` (run by `make witness`, or by the console through the
host runner) tries each credential in `config/inventory.json` once, with the
lab's own record of it: the files the lab generated in `.secrets/workload/`
and `.secrets/identity/`, and Vault's leases. It never takes a credential
from anywhere else.

| Credential | The try | Its lifetime, as the target reports it |
| --- | --- | --- |
| booking app's database password | a PostgreSQL login over TLS and a query on that session | `pg_roles.rolvaliduntil` |
| the year-long certificate | a TLS handshake with the pair (chain verified against the lab CA), then an OCSP request to Vault's `pki/ocsp` | `notAfter`, and OCSP's answer |
| Keycloak's LDAP bind password | an LDAP simple bind | no end (no rotation) until act 4 |
| booking client secret | Keycloak's client-credentials grant | no end |
| the agent's static key | `GET /api/me` on the booking API | no end |
| the CI deploy token | the booking app's deploy check | no end (the residual) |

Each answer is kept verbatim with its time and the value's fingerprint (the
first 8 hex of SHA-256). A value never leaves the witness's memory. Beside
the inventory, the witness records the secret zero (`sys/wrapping/lookup` of
the wrapped secret id Ansible delivered), the copies outside Vault (the
`.env` file, GitHub's own list of Actions secrets through `gh`, LocalStack,
Vault's Sync associations), what replaced each refused credential (the
leases' `expire_time`, the certificate the site serves), and from act 6 the
value Vault holds now for the residual.

**Unknown is not gone.** A target that does not answer (a refused
connection, a timeout, a name that does not resolve) makes the row unknown:
not standing, not refused, listed on its own.

## The scoreboard

`api/lib/scoreboard.js` computes four numbers from the witness history only.

- **Standing secrets:** inventory credentials that work now. A residual
  stands while any value of it works (the rotated one included).
- **Longest remaining lifetime:** of what works, the latest end its target
  reports, counting what replaced a refused credential; "never" while one has
  no end. A residual is listed on its own and does not hold this number at
  "never".
- **Unmanaged copies:** copies outside Vault that Vault does not keep
  current, while what they hold still works.
- **Leak window:** from the moment the act 0 note was posted (PostgreSQL's
  row) to the first witness run that saw the password refused, to the second;
  open, with its seconds so far, until then.

Every number opens the witness rows it rests on.

## The act 6 timeline

`scripts/act6-collect.sh` collects, for the drill's window: Vault's audit log
on every node (namespace `tidewell`, responses only, HMAC on, so no value is
in it), PostgreSQL's connection log for the app's dynamic users, GitHub's
update time for the deploy token and LocalStack's `LastChangedDate`.
`api/lib/timeline.js` turns them into rows:

- one row per audit response the drill is about (a sign-in, a lease lookup
  and revoke, Agent's login and its new lease, a write of the deploy token),
  with who made it and the request id;
- PostgreSQL: a user's first connection, a session ended by the revocation
  (`pg_terminate_backend` in the role's revocation statements), a refused
  login; the pool's reconnects every few seconds are left out;
- the targets' own update times.

**Derived rows.** Vault writes no audit entry when a lease expires. An
expiry row is made only for a lease that ended without a revoke, at its own
expire time, never in the future, and it says "derived".

**Systems changed by hand.** A change seen at a target counts as by hand
unless a Vault request that changed something came in the minute before it.
The audit log writes a response after the work (a revocation ends the
session 5 ms before its response is logged, measured) and LocalStack keeps
whole seconds, so a response up to 5 s after the change still accounts for
it.

**People.** Only jwt sign-ins name a person (the audit display name
`tidewell-auth-jwt-<user>`); workloads (AppRole, Agent) are not people.

## The summary

The local model (`llama3.2:3b` in `vult-ollama`) sees the rows only: id,
time, source and text. Its answer's shape is enforced by Ollama's structured
output (a JSON schema; asked in words only, the model invented its own). The
API keeps a sentence only when every row id it cites is real and it cites at
least one. When Ollama is down or slower than
`VULT_OLLAMA_SUMMARY_TIMEOUT_MS`, the summary is "not available: Ollama is
not running" and the timeline stays whole.
