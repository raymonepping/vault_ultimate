# Ownership

Who creates, changes and removes each object. Terraform never owns what a
wave, a rotation or the reset changes, so `make tf-plan ACT=current` stays
empty at every act and after a reset.

| Object | Owner | Notes |
| --- | --- | --- |
| vault-s, its Transit key and token role | Terraform `vault-seal` | |
| Seal tokens, init, root revocation, the scoped tokens | Ansible (`seal-init`, `seal-tokens`, `bootstrap`) | |
| Audit devices, namespace `tidewell`, `kv/`, `pki/` and its URLs, `jwt/` with role `person`, the groups `platform` and `bookings`, `vult-presenter` | Terraform `vault-platform` (act 0) | |
| The PKI intermediate's signing | Ansible `pki-ca` | Vault generates the key, the lab CA signs it on the host |
| `database/` and role `booking`, `approle/` and role `booking`, `vult-booking` | Terraform (act 2) | the policy grows with the act |
| Vault's connection to PostgreSQL (carries the admin password) | Ansible `act-2` | |
| PKI role `booking` (one hour); `booking-year` until act 3 | Terraform (act 3) | |
| `ldap/` and the static role `keycloak-bind` | Terraform (act 4; the role after `.build/ldap-connected`) | |
| Vault's LDAP connection, the rotation, the push into Keycloak, the booking client's authenticator | Ansible `act-4` | |
| `transit/` and key `obo`, the OAuth profile `booking-obo`, entities `teun` and `tide-agent` with their aliases, `vult-teun`, `vult-agent-ceiling` | Terraform (act 5) | |
| The agent registration, the permits | Ansible `act-5` | |
| Activation flags, the GitHub App, both destinations, the import, the associations | Ansible `act-1` (the console as Saskia can set and remove associations) | |
| The before estate: schema, manifest, `booking_app`, `booking.env`, `tide-agent.env`, the year-long certificate, the legacy secrets, the hand-made copies | Ansible `before-estate` (act 0 or `VULT_RESET=1`) | |
| The act 0 note | Ansible `canary` (Teun, through Keycloak) | |
| The wrapped secret id and Agent's (re)start | Ansible role `booking_agent` | acts 2, 3, 5, 6, `make agent`, `make up`, `make wake-up` |
| A lease revocation, a deploy-token rotation | Saskia (the console, or the act 6 wave signing her in) | |
| The copies in GitHub and LocalStack from act 1 | Vault (Secrets Sync) | removing the association deletes them |
| `.build/` records (act, witness, timeline, GitHub evidence) | the scripts that write them | names, times, fingerprints; never a value |
| The event list | the API (memory) | the reset clears it |
