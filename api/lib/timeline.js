// lib/timeline.js: act 6's evidence (D19, reframed: a revocation drill). Pure
// functions over records the drill collected; the tests feed recorded ones.
//
//   buildTimeline(raw)    rows from Vault's audit log (who, path, request id;
//                         HMAC on, so no value is ever in it), PostgreSQL's
//                         connection log, GitHub's and LocalStack's own update
//                         times, and expiry rows labelled derived (Vault
//                         writes no audit entry when a lease expires)
//   handChanges(rows)     changes seen at a target with no Vault request in
//                         the minute before: systems changed by hand
//   people(rows)          the people the audit log names (jwt logins)
//   panel(raw, rows)      the evidence panel: the drill's window to the
//                         second, hand changes, people
//   summarise(rows, ask)  Ollama's sentences that cite valid row ids only;
//                         "not available" when the model is down or slow
//
// raw: { audit: [audit log entries], pg: [jsonlog lines], targets: [{system,
// name, at}], leases: [{lease, ended_at, revoked}], drill: {declared_at,
// revoked_lease, revoked_user, revoked_at, session_gone_at, rotated_at} }

const MINUTE = 60_000;
const t = (s) => Date.parse(String(s).replace(' UTC', 'Z').replace(' ', 'T'));
const iso = (ms) => new Date(ms).toISOString();

// The audit paths the drill is about (relative to the namespace).
const AUDIT_PATHS = [
  [/^auth\/jwt\/login$/, (e) => `${e.auth?.display_name ?? 'someone'} signed in to Vault (jwt, through Keycloak)`],
  [/^sys\/leases\/lookup$/, (e) => `${e.auth?.display_name} looked up a lease`],
  [/^sys\/leases\/revoke\/(.+)$/, (e, m) => `${e.auth?.display_name} revoked lease ${short(m[1])}`],
  [/^auth\/approle\/login$/, () => 'the booking app\'s Vault Agent logged in (AppRole, a single-use secret id)'],
  [/^database\/creds\/booking$/, (e) => `Vault issued a database lease to ${e.auth?.display_name}${e.response?.secret?.lease_id ? ` (${short(e.response.secret.lease_id)})` : ''}`],
  [/^kv\/data\/ci\/deploy-token$/, (e) => `${e.auth?.display_name} wrote a new version of the CI deploy token`],
];
const short = (lease) => {
  const p = String(lease).split('/');
  return `${p.slice(0, -1).join('/')}/${String(p.at(-1)).slice(0, 8)}...`;
};

function auditRows(entries) {
  const out = [];
  for (const e of entries) {
    if (e.type !== 'response' || !e.request?.path) continue;
    if (e.request.operation === 'read' && /^kv\/data\//.test(e.request.path)) continue; // reads by Agent and Sync: not changes
    for (const [re, text] of AUDIT_PATHS) {
      const m = e.request.path.match(re);
      if (!m) continue;
      const refused = !!e.error;
      out.push({
        at: iso(t(e.time)), source: 'vault-audit', kind: 'request', change: !/lookup|login/.test(e.request.path) && !refused,
        who: e.auth?.display_name ?? null, person: personOf(e.auth?.display_name), path: e.request.path,
        text: `${text(e, m)}${refused ? ` (refused: ${String(e.error).replace(/\s+/g, ' ').trim()})` : ''}`,
        ref: e.request.id,
      });
      break;
    }
  }
  return out;
}

// jwt logins name a person: the display name is jwt-<preferred_username>,
// with the namespace's mount in front (tidewell-auth-jwt-saskia, measured).
export const personOf = (display) => (/(?:^|-auth-)jwt-(.+)$/.exec(display || '') || [])[1] ?? null;

// The app's pool reconnects every few seconds: only a user's first
// connection counts, then what ended or refused it.
function pgRows(lines, users) {
  const out = [];
  const seen = new Set();
  for (const l of lines) {
    if (!users.has(l.user)) continue;
    const m = String(l.message || '');
    let text = null;
    if (/^connection authorized/.test(m)) {
      if (seen.has(l.user)) continue;
      seen.add(l.user);
      text = `PostgreSQL: ${l.user.slice(0, 32)}... connected`;
    } else if (/terminating connection due to administrator command/.test(m)) text = `PostgreSQL: a session of ${l.user.slice(0, 32)}... ended by the revocation (pg_terminate_backend)`;
    else if (/password authentication failed|role .* does not exist/.test(m)) text = `PostgreSQL refused ${l.user.slice(0, 32)}...: ${m.slice(0, 90)}`;
    if (text) out.push({ at: iso(t(l.timestamp)), source: 'postgresql', kind: 'target', change: /ended by the revocation/.test(text), text, ref: `pid ${l.pid}` });
  }
  return out;
}

// Expiry: a lease that ended without a revoke has no audit entry, so its
// row is derived from the lease's own expire time and says so.
export function derivedExpiries(leases, auditRowsList, until = Date.now()) {
  const revoked = new Set(auditRowsList.filter((r) => /^sys\/leases\/revoke\//.test(r.path || '')).map((r) => r.path.replace('sys/leases/revoke/', '')));
  return leases
    .filter((l) => l.ended_at && t(l.ended_at) <= until && !l.revoked && !revoked.has(l.lease))
    .map((l) => ({ at: iso(t(l.ended_at)), source: 'derived', kind: 'expiry', derived: true, change: false, text: `lease ${short(l.lease)} expired (derived from its expire time: Vault writes no audit entry for an expiry)`, ref: l.lease }));
}

export function buildTimeline(raw) {
  const a = auditRows(raw.audit || []);
  const users = new Set([raw.drill?.revoked_user, ...(raw.drill?.new_users || [])].filter(Boolean));
  const rows = [
    ...a,
    ...pgRows(raw.pg || [], users),
    ...(raw.targets || []).map((x) => ({ at: iso(t(x.at)), source: x.system, kind: 'target', change: true, text: `${x.system} records ${x.name} updated (its own timestamp)`, ref: x.name })),
    ...derivedExpiries(raw.leases || [], a, t(raw.collected_at || iso(Date.now()))),
  ].sort((x, y) => t(x.at) - t(y.at));
  return rows.map((r, i) => ({ id: `R${String(i + 1).padStart(2, '0')}`, ...r }));
}

// A change at a target counts as made by hand unless a Vault request that
// changed something came in the minute before it. The audit log writes a
// response after the work is done (a revocation's statements end the
// session first: 5 ms earlier, measured), and LocalStack keeps whole
// seconds, so a response up to LAG after the change still accounts for it.
const LAG = 5_000;
export function handChanges(rows) {
  const vaultChanges = rows.filter((r) => r.source === 'vault-audit' && r.change).map((r) => t(r.at));
  return rows.filter((r) => r.kind === 'target' && r.change && !vaultChanges.some((v) => v - t(r.at) <= LAG && t(r.at) - v <= MINUTE));
}

export const people = (rows) => [...new Set(rows.map((r) => r.person).filter(Boolean))].sort();

export function panel(raw, rows) {
  const d = raw.drill || {};
  const hand = handChanges(rows);
  return {
    window: d.declared_at && d.session_gone_at
      ? { from: d.declared_at, revoked_at: d.revoked_at, session_gone_at: d.session_gone_at, seconds: Math.round((t(d.session_gone_at) - t(d.declared_at)) / 1000), revoke_to_gone_seconds: Math.round((t(d.session_gone_at) - t(d.revoked_at)) / 1000) }
      : null,
    hand_changes: hand.length,
    hand_change_rows: hand.map((r) => r.id),
    people: people(rows),
    vault_requests: rows.filter((r) => r.source === 'vault-audit').length,
  };
}

// The answer's shape, enforced by Ollama's structured output (format: a JSON
// schema): asked in words only, llama3.2:3b invented its own (measured).
export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: { sentences: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, cites: { type: 'array', items: { type: 'string' } } }, required: ['text', 'cites'] } } },
  required: ['sentences'],
};

// The model sees the rows only (id, time, source, text) and must cite them.
export function summaryPrompt(rows) {
  const list = rows.map((r) => `${r.id} ${r.at} [${r.source}${r.derived ? ', derived' : ''}] ${r.text}`).join('\n');
  return (
    'You write a short incident timeline summary for a security review. Use only these evidence rows. ' +
    'Answer only JSON: {"sentences": [{"text": "...", "cites": ["R01"]}]}, 3 to 6 sentences, each citing the row ids it rests on. ' +
    'Never state anything no row shows. Say "derived" for derived rows.\n' + list
  );
}

// Sentences whose citations are all real row ids, and at least one.
export function citedOnly(answer, rows) {
  const ids = new Set(rows.map((r) => r.id));
  let a = answer;
  if (typeof a === 'string') {
    try {
      a = JSON.parse(a);
    } catch {
      return { sentences: [], dropped: 0, error: 'the model did not answer JSON' };
    }
  }
  if (!Array.isArray(a?.sentences)) return { sentences: [], dropped: 0, error: 'the answer has no sentences list', answer: JSON.stringify(a).slice(0, 400) };
  const all = a.sentences;
  const kept = all.filter((s) => typeof s?.text === 'string' && s.text.trim() && Array.isArray(s.cites) && s.cites.length > 0 && s.cites.every((c) => ids.has(c)))
    .map((s) => ({ text: s.text.trim(), cites: s.cites }));
  return { sentences: kept, dropped: all.length - kept.length };
}

// ask(prompt) -> the model's raw answer; it must honour the deadline itself
// (a referenced setTimeout plus AbortController, see bin/timeline.js).
export async function summarise(rows, ask) {
  try {
    return { available: true, ...citedOnly(await ask(summaryPrompt(rows)), rows) };
  } catch (e) {
    return { available: false, text: 'not available: Ollama is not running', reason: String(e?.message || e) };
  }
}
