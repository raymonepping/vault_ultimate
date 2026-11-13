# State

What was built, deferred and learned, per prompt. Read this first.

## Prompt 01: Foundation (2026-11-13)

### Built

- The skeleton copied from `../vault_sync` at git HEAD `d040fdc` (`git
  archive`, never its working tree or `.secrets/`) and renamed:
  `vaultsync-` to `vult-`, `VSYNC_` to `VULT_`, namespace `lumen` to
  `tidewell`, the presenter `ines` to `saskia`, policies `vsync-` to
  `vult-`, ports 196xx to 197xx, 14101 to 14201, 14566 to 14666, the subnet
  10.89.240.0/24 to 10.89.28.0/24. The GitHub App name `vaultsyncdemo` is
  kept on purpose. The scaffold's `main.tf`, `Containerfile`,
  `.dockerignore`, `FOLDER_TREE.md` and `sanity_check.md` are gone.
- `config/defaults.conf` (D1 pins, D4 ports, the subnet with fixed addresses
  for LocalStack, PostgreSQL and the booking app, TTLs, the Ollama settings,
  the disk gate), `config/story.json` (Tidewell, Saskia and Teun, the
  schedule, the weather cancellation, the two support notes with
  placeholders only, the legacy secrets, the deploy token) and
  `config/inventory.json` (six machine credentials, one residual: the CI
  deploy token; seven copies). `scripts/story-check.js` validates both, 7
  unit tests.
- `scripts/disk-check.sh` and `make disk-check` (read-only, D20), the first
  phase of `make lab`.
- `scripts/compose.sh` knows the eight stacks; `gen-certs` has the SANs for
  every new service; `scripts/phases.txt` lists every phase, pending until
  its prompt; the Makefile stubs (`act-1` to `act-6`, `tf-plan ACT=`,
  `witness`, `scoreboard`, `wake-up`, `clean-models`, the new stack phases)
  say "not built yet" until their script exists.
- `.claude/CLAUDE.md`, `AGENTS.md`, `docs/STORY.md`; `.gitignore` also
  covers `.impeccable/` and `booking.env`.

### Measured (2026-11-13)

- Tools: Podman 6.1.4, Terraform 1.14.2, Ansible core 2.21.3, Node 25.2.1
  on the host (the images use Node 24), Vault CLI 2.1.0+ent, jq 1.8.2, gh
  2.103.3.
- `make check` OK (VM clock skew 0 s); `make license` installed from `.env`;
  `make gen-certs` and `make certs-status` (chain verifies); `make
  ports-check`: all eight ports free.
- **Disk gate: the Mac has 10 GiB free, below the 20 GiB the lab needs.**
  The Podman VM has 44 GiB free, but its disk file lives on the Mac.
  `make lab` stops at its first phase until space is reclaimed.

### Deferred

- The lab CA is named "Vault Sync Lab CA": `gen-certs` was renamed to "Vault
  Ultimate Lab" after the CA had been created, and recreating it means
  deleting files under `.secrets/tls/`, which the build session may not do.
  The SANs and the chain are correct; the next `make clean-slate` (which
  moves credentials aside) gives the new name.
- `docs/architecture.md`, `operations.md`, `security-model.md`,
  `ownership.md` and `release-checklist.md` still describe the copied lab
  (renamed); prompt 12 rewrites them. `docs/capabilities.md` was removed:
  prompt 03 writes this lab's own.
- `api/`, `web/` and `e2e/` still hold vault_sync's story code; prompts 05
  to 09 rework them.

### Learned

- Reclaiming disk from this session was refused by the harness, both the
  docker_inventory orphan removal and an edit to its review file. Cleanup is
  the operator's call, so the disk gate reports and stops; it never prunes.
- The largest safe reclaim found by docker_inventory's read-only ledger:
  13.10 GB of KinD `demo` node storage whose nodes no longer exist. The 47
  anonymous volumes from 2026-10-25 (2.49 GB) hold PostgreSQL 18's
  `18/docker` layout and may be real data of another project; keep them.

## Prompt 02: The stacks (2026-11-13)

### Built

- seal and vault from vault_sync (Shamir 1/1 seal Vault, three Raft voters,
  Transit auto-unseal), root revoked after bootstrap.
- The bootstrap policies written complete for every act:
  `vult-tf-platform` (structure: the kv, database, pki and ldap mounts, the
  approle, oidc, jwt and userpass auth methods, roles, identity groups and
  OIDC keys, the Agentic IAM profile with `sudo`, `vult-*` policies and
  token roles; denied every value, connection, lease, issued certificate,
  secret id and sync object) and `vult-ansible-platform` (Sync, activation
  flags, the KV paths `ops/`, `ci/` (read: Sync needs it), `canary/`, the
  database and LDAP connections that carry passwords, lease revocation,
  wrapped AppRole secret ids, certificate issue and revoke, the one value
  it reads: the rotated `keycloak-bind` password for act 4). The probe token
  keeps full rights in scratch `probe-*` namespaces only.
- `scripts/boundary-check.sh`: 50 platform cases for the new policies; the
  presenter's 16 wait for the people phase (`.build/people.json`).
- **identity**: OpenLDAP (`dc=tidewell,dc=lab`: saskia in `platform`, teun in
  `bookings`, `keycloak-bind` (the before estate's static bind),
  `vault-rotator` (may write keycloak-bind's password only,
  `scripts/ldap-acl.sh`)), Keycloak 26.8.1 on HTTPS 14203 with the lab
  certificate (realm `tidewell`, read-only LDAP federation, clients
  `tidewell-console` (public, PKCE), `tidewell-booking` (confidential: its
  secret is an inventory item), `tidewell-cli` (lab only, password grant for
  scripted tests), `groups` claim, audience `tidewell-vault`). Passwords are
  generated on the host into `.secrets/identity/` (create-only, 0600) by
  `scripts/identity-secrets.sh` and copied onto a volume owned by uid 1000.
  `make identity-verify`.
- **data**: PostgreSQL 17.11 from vault_identity at 10.89.28.60 (TLS 1.3 and
  SCRAM on the network, peer on the socket, jsonlog connection log).
- **ai**: `vult-ollama` 0.40.16 (arm64 checked), internal only, 4 CPUs, 6 GiB,
  one loaded model, `OLLAMA_NO_CLOUD=1`, external volume
  `vult-ollama_models`; `ansible/models.yml` pulls only what is missing.
- **cloud**: LocalStack from vault_sync at 10.89.28.50.

### Measured (2026-11-13)

- seal to bootstrap from nothing: 84 s. `make identity-up` first run 56 s,
  `make data-up` 18 s, `make ai-up` with the image pull 57 s, the three
  models (llama3.2:3b 2.0 GB, qwen3:4b 2.5 GB, qwen2.5:1.5b 986 MB) 95 s.
- `make lab` over everything up to cloud-up: 58 s, idempotency changed=0,
  drift empty, boundary 50 checks.
- `make identity-verify`: Saskia and Teun sign in through the federation
  with groups `platform` and `bookings`, audience `tidewell-vault`;
  keycloak-bind and vault-rotator bind.
- Disk: the Mac went from 27 to 16 GiB with the Ollama image and models;
  `make reclaim-host ARGS=--execute` (docker_inventory, fstrim) returned
  4.04 GB. 17 GiB free at the end of the prompt.

### Learned

- A password file written with a trailing newline works for `$(cat file)`
  but not for `curl --data-urlencode password@file` or `ldapwhoami -y`: the
  generator now writes without one, and readers strip it.
- The harness refuses sign-ins that read `.secrets/people/` from an ad hoc
  command; they run inside project scripts (`make identity-verify`), as in
  vault_sync.
- The disk gate was split: `--before-pull` (ai-up, app builds) needs
  `VULT_DISK_MIN_GIB`; `make lab`'s first phase, which may pull nothing,
  warns below it and stops only under `VULT_DISK_FLOOR_GIB` (8).

## Prompt 03: Probe (2026-11-13)

### Built

- A new `scripts/probe.sh` for this lab's twelve questions (52 cases), run on
  the 4h probe token in a scratch namespace, a scratch Keycloak realm and a
  scratch LDAP entry (`cn=probe-bind`, which `vault-rotator` may rotate);
  everything removed at the end, stale `probe-*` namespaces too. `ONLY="Q2
  Q4"` runs a subset (it does not rewrite `docs/capabilities.md`).
- `scripts/probe-ollama.mjs` (cold load, first token, tokens per second,
  valid-JSON rate) in a throwaway node container on `vult-internal`.
- `scripts/github-key.sh` (`make github-key`): the VaultSyncDemo key copied
  from `../vault_sync/.secrets/github/` by path; fingerprint 4638394b. The
  installation 181185657 covers vault_ultimate with `secrets: write`,
  `metadata: read`.
- `scripts/probe-lib.sh`: request bodies go through a file descriptor, never
  onto curl's command line (some carry a connection password or a key).
- `docs/capabilities.md`, and the answers in `prompts/00_brief.md`
  ("Measured by the probe", D21, D22).

### Measured (2026-11-13)

- `make probe`: 52 match, 0 differ, 444 s (Ollama's three models take most
  of it). No `PROBE_` secret left on GitHub, no probe role in PostgreSQL.
- The answers that changed the design: open sessions survive REVOKE plus
  DROP ROLE (pg_terminate_backend fixes it); a Vault identity token is not
  accepted as a delegation token, a Transit-signed `at+jwt` from the booking
  app is; Sync takes over hand-made copies by name; LocalStack accepts any
  access key; `llama3.2:3b` stays the model.
- Rebuilt from nothing after widening the bootstrap policies (Transit for
  the delegation key, KV `permits/` for Ansible): `make clean-slate
  CONFIRM=DELETE && make lab` 183 s.

### Learned

- `jq -r` ends its output with a newline; a form body piped into `curl
  --data-binary @-` then carries it inside the password. Use `jq -j`.
- A dropped PostgreSQL role's session has no `usename`: follow sessions by
  pid, or a live session looks gone.
- Vault's identity templates substitute placeholders as JSON values: write
  `{{identity.entity.name}}` unquoted, and a placeholder cannot sit inside a
  string.
- The audit device comes from the `vault-platform` root; it now applies in
  `make lab` from prompt 02's state on, so the probe can read Vault's reason
  for a refusal.
- `clean-slate`'s volume filter used `grep -vx` under pipefail: with only the
  models volume left it exited 1 before moving the credentials aside. Fixed.

## Prompt 04: The workload and the before estate (2026-11-13)

### Built

- `workload/booking/`: Node 24 with `pg` 8.23.1 (vault_identity's lockfile).
  Bookings, a weather cancellation, rebook and cancel-all for a crossing,
  support notes, a deploy check for CI, staff sign-in through Keycloak (code
  flow with PKCE, client `tidewell-booking`, ID token verified against the
  realm's JWKS) or a Keycloak bearer token (audience `tidewell-vault`),
  agent authentication by a static `X-Agent-Key` (until act 5) or a
  delegation token (act 5, `lib/delegation.js`). It reads its credentials
  from wherever the estate puts them (`lib/creds.js`: Vault Agent's files
  win over `booking.env`) and follows changes without a restart (polled
  fingerprints; the pool and the TLS context are rebuilt). A plain page,
  visibly not Vault glass. Cross-site writes refused. 8 unit tests.
- `workload/tide-agent/`: no dependencies. Ollama maps a request onto a
  fixed allowlist (rebook, cancel, none) and the crossing ids it was shown;
  anything else is refused (5 unit tests). Before act 5 it acts with its own
  static key for whoever asks: the before estate's problem.
- `workload/sql/schema.sql` (crossings, passengers, bookings,
  support_notes; the privileges on group role `booking_rw`),
  `scripts/manifest-sql.js` (a deterministic synthetic manifest from
  invented syllables; 4 unit tests).
- `ansible/before-estate.yml` (act 0 only, or `VULT_RESET=1`): the schema,
  the manifest, `booking_app` with a static password `VALID UNTIL
  infinity`, `booking.env` and `tide-agent.env`, a year-long certificate
  from Vault PKI, the legacy secrets and a hand-made deploy-token copy in
  LocalStack, the deploy token pasted into GitHub by hand, `.build/act` = 0.
  `ansible/canary.yml`: Teun signs in and posts the act 0 note.
- `ansible/pki-ca.yml`: Vault generates the issuing CA's key, the lab CA
  signs it on the host; the booking site's certificates chain to the lab CA
  that `make trust-root` trusts. Terraform declares the mount, URLs and the
  act-aware role `booking-year` (`count = var.act < 3`).
- `scripts/tf.sh` passes `ACT` (default `.build/act`); `make tf-plan
  ACT=6` already shows `booking-year` going.
- `compose/workload/` (booking-init copies the estate's files in place onto
  two volumes, one per system), `scripts/workload-up.sh`,
  `scripts/workload-secrets.sh` (the deploy token is generated: a value in
  `config/story.json` would have been public).

### Measured (2026-11-13)

- Rebuilt from nothing twice (Transit, then the intermediate ceremony):
  183 s and then `make lab` 64 s from the stacks. With prompt 04's phases
  `make lab` converges in 85 s; `before-estate` and `canary` changed=0 on the
  second pass.
- A booking through the API lands in PostgreSQL (booking 109); a booking
  with a foreign Origin answers `cross-site request refused`.
- The act 0 note: id 1, author teun, 181 characters.

### Learned

- Vault reads a PKI role's `ttl`/`max_ttl` back in seconds: `8760h` in
  Terraform is a permanent diff; write `31536000`.
- A Vault-internal root would need a second trust anchor in every client;
  an intermediate signed by the lab CA does not.
- The disk gate got a third threshold: builds on local base images need
  12 GiB (`VULT_DISK_BUILD_GIB`), pulls 20 GiB. The Mac stood at 16 GiB; the
  other ways to reach 20 would have deleted other labs' images or volumes.

## Prompt 05: The engine (2026-11-13, partly)

An earlier session built part of this prompt and act 1 without recording
them here; this session found them and finished what acts 2 and 3 needed.

### Built

- Act-aware Terraform (D10): `var.act` (0 to 6, validated), one file per act
  (`act2_app.tf`, `act3_certs.tf`), `booking-year` behind `act < 3`.
  `scripts/tf.sh` passes `ACT` (default `.build/act`) and the TTLs in seconds
  (`VULT_LEASE_TTL`, `VULT_CERT_TTL`). `make tf-plan ACT=current|0..6`
  (`scripts/tf-plan.sh`, `ACT=6` into `.build/terraform/whats-left.txt`).
- `scripts/act.sh` (`make act-N`): refuses unless the lab is at act N-1,
  Terraform to act N, then `ansible/act-N.yml`, then `.build/act` (written
  last) and `.build/acts/act-N.json` (duration).
- The witness: `api/lib/witness.js` (one real try per inventory credential:
  PostgreSQL login and a query on that session, LDAP simple bind, Keycloak
  client credentials, the agent key on `GET /api/me`, the deploy check, a TLS
  handshake with the year-long pair and an OCSP request to Vault's
  `pki/ocsp`), the copies (booking.env, GitHub's own record, LocalStack,
  Vault's Sync associations), the secret zero (`sys/wrapping/lookup`), the
  leases that replaced the password and the certificate the site serves.
  Answers verbatim, fingerprints, never values. `api/lib/der.js` (OCSP and
  LDAP in plain Node, no dependency); `api/bin/witness.js`;
  `scripts/witness.sh` (`make witness`): the host gathers the act, GitHub's
  record and the canary note's time, the witness runs in a throwaway
  `vult-witness` container on `vult-internal` with the lab's record mounted
  read-only. Output `.build/witness/latest.json`, `history/`,
  `scoreboard.json`.
- `api/lib/scoreboard.js`: the four numbers with evidence rows, residuals
  listed; the longest lifetime leaves residuals out (the deploy token is
  static by design and would hold it at "never" for ever).
- `make stage-reset CONFIRM=yes` (D17): `ansible/stage-reset.yml` (the app
  back on booking.env first, Agent and its renders gone, Sync associations
  and act 1's KV paths removed, the act 0 note deleted), Terraform `ACT=0`,
  `before-estate` and `canary` with `VULT_RESET=1`, the witness history
  archived, then a witness run that must count the baseline.
- `api` gets `pg` 8.23.1 (D18: the workload's one dependency).
- Tests: `api/test/der.test.js` (the OCSP request byte for byte against
  openssl's, good and revoked answers from an openssl responder; synthetic
  certificates in `api/test/fixtures`, no keys kept), `scoreboard.test.js`
  (recorded act 0, mid and after runs, "never", a leak window to the
  second). `npm test` in `api`: 44 pass.

### Deferred

- `make lab`'s `validate` phase is still pending: `ansible/validate.yml` is
  vault_sync's.
- `make witness` reads Vault with Ansible's token (reads only) until the
  console API exists; the API image has no `node_modules` yet (its
  Containerfile needs an `npm ci` stage): prompt 08.

## Prompt 06: Acts 1 to 3 (2026-11-13)

### Built

- Act 1 (earlier session): `ansible/act-1.yml` (activation flags, the GitHub
  App and both destinations, the deploy token into KV, Secrets Import of the
  legacy secrets, both associations taking over the hand-made copies (D22),
  the LocalStack originals deleted after a verified import).
- Act 2: `act2_app.tf` (database mount, role `booking` whose revocation
  statements end the role's sessions, AppRole `booking` bound to
  10.89.28.70/32, single-use secret ids, policy `vult-booking`);
  `ansible/act-2.yml` (Vault's connection to PostgreSQL, then role
  `booking_agent`, then `booking_app` NOLOGIN with no password and its
  sessions ended, the `DB_` lines out of booking.env).
- Role `ansible/roles/booking_agent` (the role id and a response-wrapped
  secret id into `.secrets/workload/approle/`, a record without values in
  `.build/agent/delivery.json`, agent-init, Agent, wait until the app runs
  on the lease) and `ansible/agent.yml`, which `make workload-up` runs when
  booking was recreated (D9, D16 will reuse it).
- Act 3: `act3_certs.tf` (role `booking`, one hour, EC P-256);
  `compose/workload/agent/tls.hcl`; `ansible/act-3.yml` (Agent again with
  the certificate template, wait until the site serves it, its notAfter
  within the TTL, then the year-long certificate revoked).
- `compose/workload/agent/` holds Agent's configuration per act: agent-init
  copies `agent.hcl`, and `tls.hcl` from act 3 (`VULT_AGENT_ACT`).
  booking-init can clear Agent's renders (`VULT_CLEAR_AGENT_OUT=1`, reset).
- The booking app: a failed reload is retried (`lib/files.js`, test
  `test/files.test.js`), the TLS source flips only after
  `setSecureContext` took the pair, and a pair that does not load falls back
  to the estate's certificate instead of stopping the app.

### Measured (2026-11-13)

| Step | Seconds | Standing | Unmanaged copies | Longest |
| --- | --- | --- | --- | --- |
| act 0 (after `stage-reset`, 28 s) | | 6 | 6 | never (booking-db-password) |
| act 1 | 13 | 6 | 1 (booking.env) | never |
| act 2 | 18 | 5 | 0 | never (keycloak-ldap-bind) |
| act 3 | 17 | 4 | 0 | never (keycloak-ldap-bind) |

- Act 2: the static password answers `password authentication failed for
  user "booking_app"`; the used secret id `400 wrapping token is not valid
  or does not exist`; the act 0 leak window closed at 49 s (the first run
  after act 2). Act 3: the year-long certificate answers `OCSP Cert Status:
  revoked`, the site serves a certificate of 3630 s (Vault backdates 30 s).
- Booking 110 made at act 3; PostgreSQL shows the app's session under
  `v-tidewell-booking-...`.
- Agent renews the lease: rendered at 14:23:39Z with 15 minutes, the same
  lease ran to 14:49:22Z at 14:41Z and the app stayed on it.
- Each wave a second time: changed=0. `make tf-plan ACT=current` empty after
  every act and after the reset. `make lab` at act 3: 77 s, every gate
  green (idempotency, drift, secret scan, boundary 50).

### Learned

- `<<-EOT` in HCL strips only the closing marker's indentation: contents
  indented deeper keep the rest, and a PEM that starts with two spaces does
  not load (`PEM routines::no start line`). JSON did not mind, which hid it
  at act 2.
- The app's file watcher stored the new fingerprint before the reload ran,
  so a reload that failed was never tried again; the site kept the old
  certificate while its health said `vault-agent`.
- Agent shares the booking container's network namespace: compose cannot
  recreate booking while Agent is attached (`has dependent containers`) and
  leaves the old container renamed `<id>_vult-booking`. `workload-up` now
  removes Agent first when booking's config hash or image changed, and
  delivers a fresh secret id after (a used one never works again).
- The booking container had been created before the `/vault/out` mount was
  added to compose; act 2's first run timed out waiting for the switch.
- Keycloak answers `unauthorized_client` for `tidewell-booking` (no service
  account) only after it authenticated the secret; the witness counts only
  `invalid_client` as refused.
- The act 0 note was gone when this session started and `canary` skips
  after act 0: the stage reset now deletes it and posts it again, so each
  rehearsal has a fresh leak window.

### Deferred

- The API route per act (`POST /api/acts/:n/run`): prompt 08, with the API
  container.
- Agent renewing the one-hour certificate before it ends was not watched
  through a full hour.

## Prompt 07: Acts 4 to 6 (2026-11-13)

Act 6 follows the brief's reframe (no note holds a credential): a revocation
drill, as the brief says it overrules this prompt.

### Built

- Act 4: `act4_people.tf` (the LDAP mount; the static role `keycloak-bind`,
  30 days, `skip_import_rotation`, behind `var.ldap_connected`);
  `ansible/act-4.yml` (Vault's LDAP connection as cn=vault-rotator, the
  marker `.build/ldap-connected`, Terraform again, rotate, push into
  Keycloak's federation over the admin REST API, Keycloak's own bind test,
  Teun signs in; the booking client switched to `client-x509` with subject
  `CN=booking`: the site's one-hour Vault certificate authenticates it over
  mutual TLS, and `OIDC_CLIENT_SECRET` leaves booking.env). Keycloak runs
  with `KC_HTTPS_CLIENT_AUTH=request` and the lab CA as truststore.
- Act 5: `act5_agent.tf` (Transit key `obo` through `vault_generic_endpoint`,
  the OAuth profile `booking-obo` with the key read from Transit, policies
  `vult-teun` and `vult-agent-ceiling`, entities `teun` and `tide-agent`
  with `profile_name` aliases; the booking policy signs with `obo` from act
  5); `ansible/act-5.yml` (agent registration with the ceiling, synthetic
  permits, Agent with its API proxy `compose/workload/agent/proxy.hcl`, the
  static key out of both .env files, the weather cancellation, Teun asks the
  agent, the scripted overreach; `.build/acts/act-5-evidence.json`).
- The booking app: `lib/delegation.js` (at+jwt for the clerk, exp bounded by
  his session and 300 s, signed through Agent's proxy; Vault decides each
  agent action by the token reading the action's permit, its answer kept
  verbatim), `POST /api/agent/ask` and `/api/agent/act` (staff), Keycloak's
  token endpoint over mutual TLS when there is no client secret, the lease id
  in `/healthz`. 4 new unit tests.
- Act 6: `ansible/act-6.yml` (Saskia signs in through Keycloak and Vault's
  jwt auth; she looks up and revokes the app's current lease; the drill
  measures until PostgreSQL has no session left; Agent logs in again; a
  booking; Saskia rotates the deploy token; Sync and Agent carry it;
  `.build/act6/drill.json`), `scripts/act6-collect.sh` (audit log,
  PostgreSQL's connection log, GitHub's and LocalStack's own times),
  `api/lib/timeline.js` and `api/bin/timeline.js`, `scripts/timeline.sh`
  (`make timeline`): rows, the evidence panel (window to the second, hand
  changes, people), a summary whose sentences must cite real rows (Ollama's
  structured output with a JSON schema); 6 unit tests.
- Agent renders the deploy token from KV (`deploy.json`,
  `static_secret_render_interval` 15 s); the witness tries Vault's current
  value beside the before estate's, so the residual stays visible after the
  rotation; the longest lifetime counts what replaced a refused credential.
- `make stage-reset` undoes acts 6 to 4 too (agent registration, permits,
  the schedule and manifest reloaded, the old bind password back in OpenLDAP
  and Keycloak, the booking client back on its secret, the drill records
  archived). `make scoreboard` (`scripts/scoreboard.sh`) prints the numbers.

### Measured (2026-11-13)

| After | Wave (s) | Standing | Unmanaged | Longest |
| --- | --- | --- | --- | --- |
| act 4 | 12 | 2 | 0 | never (the agent key) |
| act 5 | 30 | 1 (residual) | 0 | 3578 s (the one-hour certificate) |
| act 6 | 84 | 1 (residual, rotated) | 0 | 3525 s |

- Act 4: the old bind password `Invalid credentials (49)`, the old client
  secret `401 invalid_client: Invalid client or Invalid client credentials`;
  over mTLS Keycloak answers `unauthorized_client` (it authenticated the
  client; it has no service account).
- Act 5: the model planned rebook d1-1100 to d1-1530 in 8.2 s; Vault `200`
  on the rebook permit, 18 passengers moved `by tide-agent via delegation for
  teun`; the overreach `Vault 403: 2 errors occurred: * CEILING_POLICY_DENIED:
  actor ceiling policy denied permission * permission denied`; the old key
  `200 {"user":null}`.
- Act 6: the session gone 0.43 s after the revoke, bookings back on a new
  lease 12.9 s later; the old deploy token `401 deploy token refused`, the
  rotated one works and is SYNCED to both destinations; panel: 0 hand
  changes, people `saskia`; summary 6 to 7 cited sentences in 30 to 45 s.
- All six acts from a reset in a row: 14, 19, 17, 12, 30, 84 s. `make lab`
  at act 6: 78 s, every gate green. `make stage-reset` from act 6: 41 to
  44 s, the baseline. `make tf-plan ACT=6` empty after act 5 and 6.
  `npm test`: api 53, booking 13.

### Learned

- Vault creates an LDAP static role only once the engine has its connection,
  and the connection is Ansible's (it carries a password): Terraform runs
  twice in act 4, gated by `.build/ldap-connected`.
- The provider's `vault_transit_secret_backend_key` always writes
  `keys/<name>/config`, which the bootstrap policy denies Terraform (no key
  may become exportable): the key is a `vault_generic_endpoint`.
- The agent registry answers 400 `agent with provided display_name does not
  exist`, not 404.
- Audit display names carry the namespace's mount: `tidewell-auth-jwt-saskia`.
- PostgreSQL logs the revocation's session end 5 ms before Vault writes the
  revoke's audit response; LocalStack keeps whole seconds: a Vault change up
  to 5 s after a target's change still accounts for it.
- SIGHUP only reloads Agent's configuration; a revoked lease stays in its
  template until the next renewal (about two thirds of the TTL), so the
  drill gives Agent a fresh secret zero.
- `llama3.2:3b` ignores a JSON shape asked for in words; Ollama's `format`
  with a JSON schema holds it. A cold summary needs more than 20 s:
  `VULT_OLLAMA_SUMMARY_TIMEOUT_MS=90000`.
- An Ansible `register: lookup` shadows the `lookup()` function for every
  later task.
- `ldappasswd -y` keeps a trailing newline; the reset strips it first.

## Prompt 08: The console API (2026-11-13)

### Built

- `api/server.js` rewritten for this lab (vault_sync's story steps,
  `lib/story.js` and its test are gone): Saskia signs in through Keycloak
  (`lib/oidc.js`: code flow with PKCE for the public client
  `tidewell-console`; the access token is traded at once for her own Vault
  token through `auth/jwt/login`, role person; only a token carrying
  `vult-presenter` gets a session, any other is revoked). Routes as the
  prompt lists, plus `GET /api/op` (the runner's operation). Her own Vault
  actions (revoke a lease the console listed, rotate the deploy token with a
  value made in the API) carry `X-Correlation-Id`; an already-gone lease is a
  success, said so.
- The host runner (`runner/`, vault_lab_index's controller pattern, its
  `runner.js` and `redact.js` with their tests): 127.0.0.1:14209, a fresh
  bearer token per start in `.build/run/runner.token`, browsers refused, one
  allowlisted make target at a time (act-1..6, witness, timeline, plan,
  agent, github-evidence, stage-reset), redacted output.
  `scripts/runner.sh start|stop|status`; `make app-up` starts it, `make down`
  stops it. The API reaches it as `host.containers.internal`.
- `lib/console.js` (the next act only, no parameters in a body, revocable
  only a lease the console listed, a single-use reset confirmation, GitHub
  staleness), `lib/events.js` (scrub plus redaction on the way in),
  `lib/runner-client.js`.
- The witness: an unreachable target is unknown (works null), never
  refused; the scoreboard lists unknowns.
- `api/Containerfile`: `pg` from the lockfile in an `npm ci` stage.
  `compose/app`: the API mounts `.build` read-only and runs as container uid
  0 (the Mac user, no capability), nginx sends `/auth/` to the API.
- `scripts/down.sh` stops every stack (it stopped four of eight) and the
  runner. `make agent`. Phase `app-up` un-pended.
- Tests: `test/console.test.js`, `test/server.test.js`,
  `test/witness.test.js`, session tests for the jwt sign-in. `npm test` in
  api: 59 pass; runner: 10 pass.

### Measured (2026-11-13)

- `make app-build` (api, web) and `make app-up`: the API healthy behind the
  console, `/api/healthz` `{"ok":true,"act":0}`; the API container reaches
  the runner and reads `.build`.
- Runner: 401 without the token, 403 with an Origin header, 400 for a target
  off the list.

### Learned

- `.build` is 0700 on the Mac: a container uid other than 0 cannot read it
  through a bind mount (rootless Podman maps the Mac user to uid 0).

### Deferred

- The sign-in round trip through Keycloak's real form is proven by
  Playwright in prompt 09.

## Prompt 09: The console (2026-11-13)

### Built

- `web/` rewritten for this lab on vault_sync's shell (Vault daylight glass,
  `vault-ui-design`): Scoreboard (the four numbers in the ink hero, each
  opening its witness rows; the act rail with the next act's button only;
  Terraform's "what's left" verbatim), Acts (one card per act with its
  witness rows and Vault's answers), Witness, Investigation (the panel, the
  lease to revoke, Agent's fresh login, the rotation with GitHub's and
  LocalStack's times, the cited summary or "not available" with its reason,
  the timeline), Proof (events with correlation ids; the stage reset behind a
  single-use confirmation). Sign-in is a link to Keycloak. `src/format.js`
  (5 tests), `components/console.jsx` (the runner's operation, followed to
  its end), `styles/console.css` (tokens only). vault_sync's pages, map and
  CSS removed. `DESIGN.md` updated.
- API: `POST /api/agent/login` (a fresh secret zero after a console revoke);
  an act waits out a running witness (2 s) instead of answering 409; the
  runner keeps the last 20 operations, `/api/op?id=` finds one.
- `e2e/` rewritten: sign-in through Keycloak's real form, the journey (act 0,
  acts 1 to 6 from the act rail, act 6's numbers, revoke, Agent, rotate, the
  summary or its absence, axe on every page at 1440x900 and 390x844 at act
  6 and signed out, the reset from Proof), `served.spec.ts` (TLS, CSP, no
  legacy value in a bundle or an API answer, cross-site, parameters, an
  unlisted lease). The journey writes `docs/screenshots/`.

### Measured (2026-11-13)

- `make test-ui`: 28 passed in 5.8 min, axe 0 violations everywhere.
- Screenshots: scoreboard at act 0, act 6 and on a phone, acts, witness,
  investigation, proof.

### Learned

- A lease issued in a namespace ends in `.<namespace id>`
  (`database/creds/booking/...PZrqW`): the console's allowlist missed it.
- Vault's jwt login answer has no `display_name`: the API takes the user from
  the access token Vault has just accepted (`preferred_username`).
- The Scoreboard starts a witness run when the last is older than 15 s, so an
  act pressed right after must wait it out, and a test must find its own
  operation by id, not by "latest".
- With Chromium and a wave on the same 4 CPUs, the cited summary passed 90 s:
  `VULT_OLLAMA_SUMMARY_TIMEOUT_MS=180000`; the page shows the reason beside
  the prescribed "not available" line, in the amber (degraded) tint.

## Prompt 10: Rehearsal, verify, wake-up and daily operations (2026-11-13)

### Built

- `make rehearsal` (`scripts/rehearsal.sh`, `scripts/rehearsal.mjs`): a
  stage reset; Saskia signs in through Keycloak's real code flow (followed by
  hand, no browser); act 0's baseline and the open leak window; acts 1 to 6
  through the console API with bookings made during each wave, the witness
  numbers after each, Vault's answers (GitHub's and LocalStack's records,
  the refused password and secret id, OCSP, the bind password, the client
  secret, the delegation and the ceiling, act 6's revoke, rotation,
  timeline, panel and summary); the negatives; no known value and no Vault
  token in 156 API answers, five containers' logs, the witness history or the
  timeline; a stage reset back to the baseline. Its output is kept in
  `.build/rehearsal.log`.
- `make verify` sections rewritten for this lab (platform: jwt, the act's
  mounts, the validate phase; stacks; ollama; app and console; units: every
  suite), and a latent bug fixed: a failing check that printed nothing ended
  the whole run under pipefail.
- `ansible/validate.yml` rewritten (Saskia through Keycloak, her own
  capabilities on six paths exactly as `vult-presenter` says, the app on the
  credential the act says); phase `validate` un-pended.
- `make wake-up` (`scripts/wake-up.sh`, the decision in
  `scripts/wake-decide.js`, 5 tests): clock, broken services through their
  stacks, Vault health and a leader, a fresh secret id for Agent from act 2.
- `scripts/up.sh` rewritten for every stack (identity, data, ai and cloud in
  parallel, a LocalStack that started empty gets its act's content back:
  `before-estate` at act 0, `ansible/reconcile-localstack.yml` from act 1;
  Agent's fresh login when needed), each step with its duration;
  `scripts/down.sh` stops every stack and the runner. `make doctor` is
  act-aware and covers every stack, the VM disk, the licence, the GitHub
  App's installation and Ollama's model. Lint: ansible-lint and shellcheck
  clean (21 findings fixed, three `no-handler` with their reason).

### Measured (2026-11-13)

- `make verify`: 91 passed, 0 failed, 425 s (the rehearsal 60 passed, 0
  failed, 298 s).
- `make down` 22 s; `make up RUNTIME=podman` from stopped: 116 s before the
  stacks started in parallel, **76 s** after (Vault 24 s, the four stacks 35 s
  bound by Keycloak, LocalStack's re-seed 10 s, workload 5 s, console 2 s):
  inside the 90 s budget.
- `make wake-up`: a no-op in 2 s; a stopped `vult-tide_agent` restarted in
  2 s; at act 2 a stopped Vault Agent back on a fresh secret id with the app
  on its lease in 24 s, and a real 7 s VM clock skew fixed on the way.

### Learned

- Vault tags its LocalStack copy `hashicorp:vault` with an empty value: test
  the key, not its truthiness.
- `compose run` of a one-shot starts its dependencies again (Keycloak's
  bootstrap brought `identity-init` back): `--no-deps` when the service runs.
- macOS's `/bin/bash` is 3.2: no associative arrays in scripts the Lab Index
  may run.
- An Ansible dict's keys are not templated: a list of `{path, caps}` instead.

## Prompt 11: The Lab Index, end to end (2026-11-13)

The Lab Index (`../vault_lab_index`, controller on 18801, `vlix-ui` on
18800) was running and was not changed. A Playwright script on its own hooks
(`data-lab`, `data-testid="stop"`, `confirm-stop`, `start`, `status`):

- After Refresh, vault_ultimate is eligible with prefix `vult-` (source
  `lab`), the README's title "vault_ultimate: Zero Standing Secrets" and its
  first paragraph, status Running.
- Stop through the dashboard and its confirmation dialog: **25 s** to
  Stopped ("13 stopped"); every one of the 23 `vult-` volumes kept,
  `vult-ollama_models` included (compared before and after).
- Start: **74 s** to Running; then `make verify` 91 passed, 0 failed (440 s),
  the lab at act 0 as before the stop.
- Screenshots: `docs/screenshots/lab-index-running.png`,
  `lab-index-stopped.png`. Only vault_ultimate was stopped or started.

For vault_lab_index's own backlog (not built here): a **"Wake all"** button
that runs `make wake-up` in every running lab that has the target, after the
Mac slept (one controller operation per lab, in turn, with each lab's one
screen of what it fixed).

## Prompt 12: Docs, public readiness and the final run (2026-11-13)

### Built

- `README.md` rewritten for this lab (the first paragraph the Lab Index
  shows, the split quote, what it proves and only illustrates, the seven
  acts, the scoreboard with the measured numbers, prerequisites, first run,
  daily, checks, ports, where things are). `docs/architecture.md`,
  `operations.md`, `security-model.md`, `ownership.md` rewritten; new
  `docs/evidence-model.md` (the witness, the scoreboard's rules, the
  timeline, derived rows, hand changes, people, the citation rule);
  `docs/STORY.md` brought in line with the reframe; `DESIGN.md`,
  `CHANGELOG.md` (1.0.0), `CONTRIBUTING.md`. markdownlint clean, no em
  dashes.
- CI runs every unit suite (api with pg, web, booking, tide-agent, runner,
  scripts), the console build and `make lint`; Dependabot covers the booking
  app too. `article/STYLE.md` (private) from the medium-article template.
- `make boundary`: Saskia's 16 rows rewritten for this lab's
  `vult-presenter`, through her real sign-in (`person_login`: Keycloak, then
  jwt; it reports Keycloak's error code): 66 checks, none skipped (before:
  16 always skipped, waiting for vault_sync's userpass phase).
- `make clean-slate` also stops the runner, archives the witness history and
  act 6's records, and clears the act records (a rebuild starts at act 0).

### Measured (2026-11-13)

- From stopped: `make down` 22 s, `make up RUNTIME=podman` 76 s, `make
  verify` 91/0, `make test-ui` 28/28 (axe 0).
- From nothing: `make clean-slate CONFIRM=DELETE` 63 s, **`make lab` 226 s**
  (budget 300 s; every gate green), `make verify` 91/0 (409 s, rehearsal
  60/0).
- Public readiness: no private path or address in the files to commit;
  `prompts/`, `input/`, `article/`, `.build/`, `.secrets/`, `backups/`,
  `.claude/`, `.agents/`, `.codex/`, `AGENTS.md`, `.env`, `booking.env`
  ignored; gitleaks on exactly the commit set: no leaks.

### Learned

- A fresh intermediate signed "now" by the lab CA refused the first year-long
  certificate: `notBefore before signer's notBefore` (Vault backdates leaves
  by 30 s). The lab CA now signs it valid from an hour ago.
- Before act 1, Sync answers 403 "the Secrets Sync feature is not activated":
  the reset accepts exactly that refusal as "no association".
- A failed reset that had truncated the booking tables showed up next as a
  non-idempotent `before-estate`: fix the cause, not the gate.
