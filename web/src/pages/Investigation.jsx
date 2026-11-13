// pages/Investigation.jsx: act 6, the revocation drill. The lease to revoke
// (the booking app's current one, listed by the API), the deploy rotation,
// the timeline from Vault's audit log, PostgreSQL's connection log and the
// targets' own times (derived rows marked), the evidence panel, and the
// summary whose every sentence cites rows, or "not available".
import { useState } from 'react';
import { KeyRound, ShieldOff } from 'lucide-react';
import { call } from '../api.js';
import { useResource } from '../hooks.js';
import { ErrorNotice, Loading, TableScroll } from '../components/ui.jsx';
import { Hero, Pill, useOp, OpPanel, RunButton } from '../components/console.jsx';

const SOURCE = { 'vault-audit': ['healthy', 'Vault audit'], postgresql: ['pending', 'PostgreSQL'], github: ['none', 'GitHub'], localstack: ['none', 'LocalStack'], derived: ['none', 'derived'] };

function useAction() {
  const [state, setState] = useState({ busy: false, event: null, error: null });
  const run = async (label, path) => {
    setState({ busy: true, event: null, error: null });
    try {
      const r = await call(label, path, { method: 'POST' });
      setState({ busy: false, event: r.event, error: null });
      return r;
    } catch (error) {
      setState({ busy: false, event: null, error });
      return null;
    }
  };
  return { ...state, run };
}

function Said({ event }) {
  if (!event) return null;
  return (
    <p className="inline-notice" role="status">
      {event.what}: Vault {event.vault?.status ?? ''}
      {event.already_gone ? ' (already gone)' : ''}
      {event.version ? `, version ${event.version}` : ''}, correlation id <code className="mono">{event.correlation_id}</code>
    </p>
  );
}

export default function Investigation() {
  const inv = useResource('investigation', '/api/investigation', { intervalMs: 15000 });
  const leases = useResource('leases', '/api/leases');
  const op = useOp(() => inv.reload());
  const revoke = useAction();
  const rotate = useAction();
  if (inv.error?.status === 401) return <ErrorNotice error={inv.error} />;
  const t = inv.data?.timeline;
  const p = t?.panel;
  const lease = leases.data?.leases?.[0];
  const targets = (t?.rows || []).filter((r) => r.source === 'github' || r.source === 'localstack');
  return (
    <>
      <Hero title="The revocation drill" lede="Act 6: Saskia revokes the booking app's current lease with her own Vault token, its PostgreSQL sessions end at once, Agent logs in again, and she rotates the deploy token. Every row below comes from a system's own record; the model only summarises rows it cites.">
        {p && (
          <div className="score-grid score-grid--three">
            <div className="score-tile score-tile--static">
              <span className="score-tile__label">Leak window</span>
              <span className="score-tile__value num">{p.window ? `${p.window.seconds} s` : 'n/a'}</span>
              <span className="score-tile__sub">{p.window ? `revoke to session gone: ${p.window.revoke_to_gone_seconds} s` : 'no drill yet'}</span>
            </div>
            <div className="score-tile score-tile--static">
              <span className="score-tile__label">Systems changed by hand</span>
              <span className="score-tile__value num">{p.hand_changes}</span>
              <span className="score-tile__sub">every change was a Vault request ({p.vault_requests} in the audit log)</span>
            </div>
            <div className="score-tile score-tile--static">
              <span className="score-tile__label">People the audit log names</span>
              <span className="score-tile__value">{p.people.length ? p.people.join(', ') : 'none'}</span>
              <span className="score-tile__sub">jwt sign-ins through Keycloak</span>
            </div>
          </div>
        )}
      </Hero>
      <ErrorNotice error={inv.error || revoke.error || rotate.error || op.error} title="Refused" />

      <div className="grid-2">
        <section className="vg-card" aria-labelledby="lease-h">
          <h3 id="lease-h">The lease to revoke</h3>
          {lease ? (
            <>
              <p className="m-0">
                <code className="mono break">{lease.lease}</code>
              </p>
              <p className="m-0 dim">{lease.holder}</p>
            </>
          ) : (
            <p className="dim">The booking app has no Vault lease yet (act 2 gives it one).</p>
          )}
          <button
            type="button"
            className="destructive-button"
            disabled={!lease || revoke.busy}
            onClick={async () => {
              await revoke.run('Revoke the lease', `/api/leases/${encodeURIComponent(lease.lease)}/revoke`);
              leases.reload();
            }}
          >
            <ShieldOff size={14} aria-hidden="true" /> Revoke this lease
          </button>
          <Said event={revoke.event} />
          <p className="m-0 dim">Agent renews a lease at about two thirds of its life, so a revoked lease stays dead in its template until then: give Agent a fresh single-use secret id and bookings come back at once.</p>
          <RunButton label="Agent logs in again" kind="secondary" busy={op.running} onClick={() => op.start('Agent logs in again', '/api/agent/login')} />
        </section>
        <section className="vg-card" aria-labelledby="rot-h">
          <h3 id="rot-h">Rotate the deploy token</h3>
          <p className="m-0">A new version of <code className="mono">kv/ci/deploy-token</code>, its value made by the API and never shown. Secrets Sync carries it to GitHub and LocalStack, Agent to the app.</p>
          <button type="button" className="primary-button" disabled={rotate.busy} onClick={() => rotate.run('Rotate the deploy token', '/api/rotate/deploy')}>
            <KeyRound size={14} aria-hidden="true" /> Rotate once
          </button>
          <Said event={rotate.event} />
          {targets.length > 0 && (
            <ul className="evidence-list">
              {targets.map((r) => (
                <li key={r.id}>
                  {r.text} at <time dateTime={r.at}>{new Date(r.at).toLocaleTimeString()}</time> ({r.id})
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="vg-card" aria-labelledby="sum-h">
        <div className="card-head">
          <h3 id="sum-h">Summary</h3>
          <RunButton label="Write the summary again" kind="secondary" busy={op.running} disabled={!t} onClick={() => op.start('Summary', '/api/investigation/summary')} />
        </div>
        {!t ? (
          <p className="dim">No drill yet: run act 6.</p>
        ) : t.summary.available ? (
          <>
            <ul className="summary-list">
              {t.summary.sentences.map((s) => (
                <li key={s.text}>
                  {s.text}{' '}
                  {s.cites.map((c) => (
                    <a key={c} href={`#/investigation`} className="cite" onClick={(e) => { e.preventDefault(); document.getElementById(`row-${c}`)?.focus(); }}>
                      {c}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
            <p className="m-0 dim">
              {t.model}, {Math.round(t.model_ms / 1000)} s. {t.summary.dropped ? `${t.summary.dropped} sentence(s) dropped: they cited no real row.` : 'Every sentence cites real rows.'}
              {t.summary.error ? ` ${t.summary.error}.` : ''}
            </p>
          </>
        ) : (
          <p className="inline-notice pending">
            {t.summary.text}
            {t.summary.reason ? ` (${t.summary.reason}). The timeline below is whole.` : ''}
          </p>
        )}
      </section>
      <OpPanel op={op.op} />

      <section className="vg-card" aria-labelledby="tl-h">
        <div className="card-head">
          <h3 id="tl-h">Timeline</h3>
          <span className="card-sub">From each system&apos;s own record; HMAC on in the audit log, so no value is in it</span>
        </div>
        {!inv.data ? (
          <Loading />
        ) : !t ? (
          <p className="dim">No drill yet.</p>
        ) : (
          <TableScroll label="Timeline">
            <table className="vg-table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Time (UTC)</th>
                  <th scope="col">Source</th>
                  <th scope="col">What it records</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r) => (
                  <tr key={r.id} id={`row-${r.id}`} tabIndex={-1}>
                    <td>
                      <code className="mono">{r.id}</code>
                    </td>
                    <td className="num">{r.at.slice(11, 23)}</td>
                    <td>
                      <Pill kind={(SOURCE[r.source] || ['none'])[0]}>{(SOURCE[r.source] || [r.source, r.source])[1]}</Pill>
                    </td>
                    <td>
                      {r.text}
                      {r.ref && r.source === 'vault-audit' ? (
                        <span className="dim">
                          {' '}
                          request <code className="mono">{r.ref.slice(0, 8)}</code>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>
    </>
  );
}
