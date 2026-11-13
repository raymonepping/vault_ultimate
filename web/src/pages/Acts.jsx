// pages/Acts.jsx: one view per act: what it removes, how, its record (when,
// how long), the witness rows of the credentials it removes, and Vault's own
// answers (act 5's delegation and overreach, act 6's drill).
import { useResource } from '../hooks.js';
import { ErrorNotice, Loading } from '../components/ui.jsx';
import { Hero, Pill, Ago, Fp, useNow, useOp, OpPanel, RunButton } from '../components/console.jsx';
import { ActRail } from './Scoreboard.jsx';
import { ACTS, tidy } from '../format.js';

function Rows({ rows, now }) {
  if (!rows.length) return null;
  return (
    <ul className="evidence-list">
      {rows.map((r) => (
        <li key={r.id} className="evidence-row">
          <div className="evidence-row__head">
            <code className="mono">{r.id}</code>
            <Pill kind={r.works === null ? 'pending' : r.works ? 'rejected' : 'healthy'}>{r.works === null ? 'unknown' : r.works ? 'still works' : 'refused'}</Pill>
            <span className="dim">
              <Ago at={r.at} now={now} />, <Fp v={r.fingerprint} />
            </span>
          </div>
          <code className="said-error">{r.answer}</code>
        </li>
      ))}
    </ul>
  );
}

function Act5({ ev }) {
  if (!ev) return null;
  return (
    <dl className="facts">
      <dt>The agent&apos;s plan</dt>
      <dd>
        {typeof ev.asked === 'string' ? ev.asked : `${ev.asked.plan.action} ${ev.asked.plan.from} to ${ev.asked.plan.to}, ${ev.asked.moved} passengers moved with Teun's delegation (model ${Math.round(ev.asked.model_ms / 100) / 10} s)`}
      </dd>
      <dt>The overreach</dt>
      <dd>
        HTTP {ev.overreach.status}: <code className="said-error">{tidy(ev.overreach.answer)}</code>
      </dd>
    </dl>
  );
}

function Act6({ d }) {
  if (!d) return null;
  const s = (a, b) => `${Math.round((Date.parse(b) - Date.parse(a)) / 100) / 10} s`;
  return (
    <dl className="facts">
      <dt>Revoked</dt>
      <dd>
        <code className="mono">{d.revoked_lease}</code> by Saskia
      </dd>
      <dt>Session gone</dt>
      <dd>{s(d.revoked_at, d.session_gone_at)} after the revoke</dd>
      <dt>Bookings back</dt>
      <dd>{s(d.session_gone_at, d.bookings_back_at)} later, on a new lease (booking {d.booking?.booking ?? 'n/a'})</dd>
      <dt>Deploy token</dt>
      <dd>rotated to version {d.rotated_version}; the old value: {d.old_deploy_token}</dd>
    </dl>
  );
}

export default function Acts() {
  const now = useNow();
  const acts = useResource('acts', '/api/acts', { intervalMs: 15000 });
  const witness = useResource('witness', '/api/witness', { intervalMs: 15000 });
  const op = useOp(() => {
    acts.reload();
    witness.reload();
  });
  if (acts.error?.status === 401) return <ErrorNotice error={acts.error} />;
  const act = acts.data?.act ?? 0;
  const rows = witness.data?.latest?.credentials || [];
  return (
    <>
      <Hero title="One class of secret per act" lede="The same running booking app, migrated act by act. Each act runs on the host as a wave (Terraform declares, Ansible does the runtime work) and only in order: the API refuses anything but the next act.">
        <ActRail act={act} op={op} />
      </Hero>
      <ErrorNotice error={acts.error || op.error} title="The console could not do that" />
      <OpPanel op={op.op} />
      {!acts.data ? (
        <Loading />
      ) : (
        ACTS.filter((a) => a.n > 0).map((a) => {
          const rec = acts.data.acts.find((x) => x.n === a.n)?.record;
          const state = a.n <= act ? 'done' : a.n === act + 1 ? 'next' : 'later';
          return (
            <section key={a.n} className={`vg-card act-card act-card--${state}`} aria-labelledby={`act-${a.n}-h`}>
              <div className="card-head">
                <h3 id={`act-${a.n}-h`}>
                  Act {a.n}: {a.title}
                </h3>
                <Pill kind={state === 'done' ? 'healthy' : state === 'next' ? 'pending' : 'none'}>{state === 'done' ? 'done' : state === 'next' ? 'next' : 'later'}</Pill>
              </div>
              <p className="m-0">
                <strong>Removes {a.removes}.</strong> {a.how}
              </p>
              {rec && (
                <p className="m-0 dim">
                  Ran <Ago at={rec.at} now={now} /> in {rec.seconds} s.
                </p>
              )}
              <Rows rows={rows.filter((r) => r.removed_by_act === a.n)} now={now} />
              {a.n === 5 && <Act5 ev={acts.data.act5} />}
              {a.n === 6 && <Act6 d={acts.data.act6} />}
              {state === 'next' && <RunButton label={`Run act ${a.n}`} busy={op.running} onClick={() => op.start(`Act ${a.n}`, `/api/acts/${a.n}/run`)} />}
            </section>
          );
        })
      )}
    </>
  );
}
