// pages/Proof.jsx: what this console did, newest first: every sign-in,
// wave, revoke and rotation, sanitized (no value, token or key), with the
// correlation id Vault's audit log records next to Saskia's name. The stage
// reset lives here, behind a single-use confirmation.
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { call } from '../api.js';
import { useResource } from '../hooks.js';
import { ErrorNotice, Loading } from '../components/ui.jsx';
import { Hero, Pill, Ago, useNow, useOp, OpPanel } from '../components/console.jsx';
import { tidy } from '../format.js';

export default function Proof() {
  const now = useNow();
  const events = useResource('events', '/api/events', { intervalMs: 5000 });
  const op = useOp(() => events.reload());
  const [confirm, setConfirm] = useState(null);
  const [err, setErr] = useState(null);
  if (events.error?.status === 401) return <ErrorNotice error={events.error} />;
  const list = events.data?.events;
  const ask = async () => {
    setErr(null);
    try {
      setConfirm((await call('Stage reset: confirm', '/api/stage-reset')).confirm);
    } catch (e) {
      setErr(e);
    }
  };
  const reset = async () => {
    const c = confirm;
    setConfirm(null);
    await op.start('Stage reset', '/api/stage-reset', { confirm: c });
  };
  return (
    <>
      <Hero title="What happened" lede="Every action this console took, newest first, as Saskia. Each Vault call carries a correlation id that Vault's audit log records next to her name. Kept in the API's memory, the last 200; a stage reset clears them." />
      <ErrorNotice error={events.error || err || op.error} />
      <section className="vg-card" aria-labelledby="ev-h">
        <div className="card-head">
          <h3 id="ev-h">Events</h3>
          <span className="card-sub">Sanitized: fields named like a secret are dropped, token-shaped text redacted</span>
        </div>
        {!list ? (
          <Loading />
        ) : list.length === 0 ? (
          <p className="dim">Nothing yet. Run act 1 on the Scoreboard.</p>
        ) : (
          <ol className="events">
            {list.map((e, i) => (
              <li key={`${e.at}-${i}`} className="event">
                <div className="event__head">
                  <Pill kind={e.vault && e.vault.status >= 300 && !e.already_gone ? 'rejected' : 'healthy'}>{e.state || (e.vault ? `Vault ${e.vault.status}` : 'done')}</Pill>
                  <strong>{e.what}</strong>
                  <span className="dim">
                    by {e.by}, <Ago at={e.at} now={now} />
                  </span>
                </div>
                {e.correlation_id && (
                  <p className="m-0 dim">
                    correlation id <code className="mono">{e.correlation_id}</code>
                    {e.vault?.request_id ? (
                      <>
                        , Vault request <code className="mono">{e.vault.request_id}</code>
                      </>
                    ) : null}
                  </p>
                )}
                {(e.vault?.errors || []).map((x) => (
                  <code key={x} className="said-error">
                    {tidy(x)}
                  </code>
                ))}
              </li>
            ))}
          </ol>
        )}
      </section>
      <OpPanel op={op.op} />
      <section className="vg-card" aria-labelledby="reset-h">
        <h3 id="reset-h">Stage reset</h3>
        <p className="m-0">Back to act 0 on purpose (D17): the static password, the year-long certificate, the old bind password, the agent&apos;s key, the hand-made copies and the act 0 note all come back, and the witness must count the baseline again.</p>
        {!confirm ? (
          <button type="button" className="secondary-button" onClick={ask} disabled={op.running}>
            <RotateCcw size={14} aria-hidden="true" /> Stage reset…
          </button>
        ) : (
          <div className="form-actions">
            <button type="button" className="destructive-button" onClick={reset}>
              <RotateCcw size={14} aria-hidden="true" /> Yes, back to act 0
            </button>
            <button type="button" className="secondary-button" onClick={() => setConfirm(null)}>
              Keep the lab as it is
            </button>
          </div>
        )}
      </section>
    </>
  );
}
