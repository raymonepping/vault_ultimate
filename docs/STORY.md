# Zero Standing Secrets: Tidewell Ferries

Tidewell Ferries is fictional. It books crossings on the MV Tidewell Star
between Kelmouth and Arnsey Quay, and its booking application runs on the
estate most companies have. Every name, value and passenger in this lab is
invented.

## The people

- **Saskia**, a platform engineer, presents. Her own Vault session (OIDC
  through Keycloak) runs every act, so Vault's audit log names her.
- **Teun**, a booking clerk, works in the booking app, writes the support
  notes, and is the person the AI agent acts for.
- **Passengers** exist only as synthetic manifest rows.

## The scoreboard

A witness tries every machine credential in `config/inventory.json` with a
real request. The scoreboard shows four numbers, each with its evidence:
standing secrets (credentials that work right now while nobody uses them),
longest remaining lifetime, unmanaged copies, and the leak window.

## The acts

| Act | What happens | Removes |
| --- | --- | --- |
| 0. The leak | Teun pastes the database connection string into a support note. It works, and it is also in `booking.env`, the hand-pasted GitHub secret and the LocalStack copy. | (baseline) |
| 1. One home | Secrets Import brings the scattered secrets into Vault; Secrets Sync takes over the GitHub and LocalStack copies. | unmanaged copies |
| 2. The app | A wrapped, single-use secret id gets the app in; its PostgreSQL password becomes a lease that Vault Agent delivers. | the static database password |
| 3. Certificates | The year-long certificate is revoked; Agent renews one-hour certificates. | the long-lived TLS key |
| 4. People and the bind account | Vault rotates the LDAP bind password Keycloak uses. | the LDAP bind password |
| 5. The agent loses its key | A crossing is cancelled for weather; the agent rebooks its passengers for Teun with narrow delegated authority, and one overreach is refused. | the agent's static key |
| 6. The leak again | A new note leaks the app's current credential and the deploy token. The lease dies by itself and by one revocation, its open session ends, one rotation reaches GitHub and LocalStack, and the agent writes the timeline from Vault's evidence. | (the proof) |

## Proves and illustrates

**Proves:** a running application can lose every standing machine secret it
had without downtime; the numbers are measured by trying each credential; a
leaked credential in the after estate dies within its TTL or seconds after
one revocation, open session included; one rotation in Vault reaches every
copy; an agent acting for a person stays inside narrow delegated authority;
the investigation's evidence comes from Vault, the database and the app,
never from the model.

**Illustrates only:** Tidewell is fiction; LocalStack stands in for AWS;
Ansible stands in for a platform that vouches for workloads; one presenter
drives everything; one Mac is not production.
