// format.js: how the console says numbers and acts. Pure, tested
// (test/format.test.js).

// A remaining lifetime from the scoreboard: "never", or a duration.
export function lifetime(longest) {
  if (!longest) return { text: 'unknown', sub: 'no witness run yet' };
  if (longest.never) return { text: 'never', sub: `${longest.id}: no end date, no rotation` };
  if (longest.seconds === null || longest.seconds === undefined) return { text: 'unknown', sub: 'the target did not say' };
  return { text: duration(longest.seconds), sub: longest.id ? `${longest.id}${longest.replacement ? ', what replaced it' : ''}` : 'nothing standing but residuals' };
}

export function duration(s) {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${Math.round(s / 360) / 10} h`;
  return `${Math.round(s / 86400)} days`;
}

// A leak window: open (so far) or closed, to the second.
export function leakWindow(w) {
  if (!w) return { text: 'none yet', sub: 'no canary posted' };
  if (w.open) return { text: w.seconds === null ? 'open' : `${duration(w.seconds)}+`, sub: 'still open: the leaked credential works' };
  return { text: duration(w.seconds), sub: `closed ${new Date(w.closed_at).toLocaleTimeString()}` };
}

// The six acts: what each removes and how.
export const ACTS = [
  { n: 0, title: 'The before estate', removes: 'nothing yet', how: 'A database password in a file, an LDAP bind password nobody rotates, a year-long certificate, a deploy token pasted into CI, an AI agent with a static key. Teun posts a support note that says the app still runs on the old password.' },
  { n: 1, title: 'One home', removes: 'the unmanaged copies', how: 'Secrets Import brings the legacy secrets into KV; Secrets Sync takes over the hand-made GitHub and LocalStack copies of the deploy token under their own names, then the originals are retired.' },
  { n: 2, title: 'The app', removes: "the booking app's database password", how: 'Ansible hands Vault Agent a response-wrapped, single-use AppRole secret id; Agent logs in once and renders a 15-minute lease; the static role loses LOGIN and its password.' },
  { n: 3, title: 'Certificates', removes: 'the year-long certificate', how: 'Agent issues the site a one-hour certificate and renews it; the app swaps its TLS context without a restart; the year-long certificate is revoked and OCSP says so.' },
  { n: 4, title: 'People and the bind account', removes: "Keycloak's bind password and the booking client secret", how: "Vault's LDAP engine rotates keycloak-bind and pushes it into Keycloak; Keycloak takes the site's one-hour Vault certificate (mutual TLS) instead of a client secret." },
  { n: 5, title: 'The agent loses its key', removes: "the agent's static key", how: "The booking app signs a delegation token for the clerk with a Transit key that never leaves Vault; the agent rebooks with Teun's authority, and Vault refuses anything above its ceiling." },
  { n: 6, title: 'The revocation drill', removes: 'the leaked lease and the old deploy token', how: "Saskia revokes the app's current lease (its sessions end at once), Agent logs in again, and she rotates the deploy token; the timeline is built from Vault's audit log and the targets' own times." },
];

// "1 error occurred: * x" -> "x"
export const tidy = (v) => String(v).replace(/^\d+ errors? occurred:\s*/, '').replace(/^\*\s*/, '').replace(/\s+\*\s+/g, '; ').replace(/\s+/g, ' ').trim();
