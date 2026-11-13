# Zero Standing Secrets: Tidewell Ferries

Tidewell Ferries is fictional. It books crossings on the MV Tidewell Star
between Kelmouth and Arnsey Quay, and its booking application runs on the
estate most companies have. Every name, value and passenger in this lab is
invented.

## The people

- **Saskia**, a platform engineer, presents. Her own Vault session (OIDC
  through Keycloak) runs every act, so Vault's audit log names her.
- **Teun**, a booking clerk, works in the booking app, writes the act 0
  support note, and is the person the AI agent acts for.
- **Passengers** exist only as synthetic manifest rows.

## The scoreboard

A witness tries every machine credential in `config/inventory.json` with a
real request. The scoreboard shows four numbers, each with its evidence:
standing secrets (credentials that work right now while nobody uses them),
longest remaining lifetime, unmanaged copies, and the leak window.

## The acts

| Act | What happens | Removes |
| --- | --- | --- |
| 0. The before estate | Teun posts a support note: the app still runs on the old static database password from the runbook. The note holds no credential, but the password it names works, never expires, and also sits in `booking.env`; the deploy token is pasted into GitHub and LocalStack by hand. The leak window opens. | (baseline) |
| 1. One home | Secrets Import brings the scattered secrets into Vault; Secrets Sync takes over the GitHub and LocalStack copies. | unmanaged copies |
| 2. The app | A wrapped, single-use secret id gets the app in; its PostgreSQL password becomes a lease that Vault Agent delivers. | the static database password |
| 3. Certificates | The year-long certificate is revoked; Agent renews one-hour certificates. | the long-lived TLS key |
| 4. People and the bind account | Vault rotates the LDAP bind password Keycloak uses and pushes it into Keycloak; Keycloak takes the booking app's one-hour Vault certificate (mutual TLS) instead of a client secret. | the LDAP bind password and the client secret |
| 5. The agent loses its key | A crossing is cancelled for weather; the agent rebooks its passengers for Teun with narrow delegated authority, and one overreach is refused. | the agent's static key |
| 6. The revocation drill | Saskia revokes the app's current lease with her own token: its open PostgreSQL session ends at once and Vault Agent logs in again. She rotates the deploy token once and both destinations' own clocks show it. The timeline comes from Vault's audit log, PostgreSQL's connection log and the targets' own times; the local model only summarises rows it cites. | the leaked lease, the old deploy token |

## Proves and illustrates

**Proves:** a running application can lose every standing machine secret it
had while bookings keep working; the numbers are measured by trying each
credential; a credential in the after estate lives minutes and dies within a
second of one revocation, open session included; one rotation in Vault
reaches every copy; an agent acting for a person stays inside narrow
delegated authority, and Vault, not the app, refuses the overreach; the
investigation's evidence comes from Vault, the database and the targets,
never from the model. One credential stays: the CI deploy token, a counted
residual (GitHub's runners cannot reach this lab's Vault).

**Illustrates only:** Tidewell is fiction; LocalStack stands in for AWS;
Ansible stands in for a platform that vouches for workloads; one presenter
drives everything; one Mac is not production.
