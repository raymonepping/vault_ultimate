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
