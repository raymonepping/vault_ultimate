// pages/Scoreboard.jsx: the hero. The four numbers (D4) from the witness,
// each opening the rows it rests on; the act rail with the next act's button
// only (the API refuses any other); Terraform's "what's left", verbatim.
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useResource } from '../hooks.js';
import { ErrorNotice, Loading, Drawer, TableScroll } from '../components/ui.jsx';
import { Hero, Pill, Ago, Fp, useNow, useOp, OpPanel, RunButton } from '../components/console.jsx';
import { ACTS, lifetime, leakWindow } from '../format.js';

function Tile({ label, value, sub, onOpen }) {
  return (
    <button type="button" className="score-tile" onClick={onOpen} aria-haspopup="dialog">
      <span className="score-tile__label">{label}</span>
      <span className="score-tile__value num">{value}</span>
      <span className="score-tile__sub">{sub}</span>
    </button>
  );
}

export function Evidence({ ids, latest, now }) {
  const rows = [...(latest?.credentials || []), ...(latest?.copies || [])].filter((r) => ids.includes(r.id));
  if (!rows.length) return <p className="dim">No row: nothing counts here right now.</p>;
  return (
    <ul className="evidence-list">
      {rows.map((r) => (
        <li key={r.id} className="evidence-row">
          <div className="evidence-row__head">
            <code className="mono">{r.id}</code>
            {'works' in r ? <Pill kind={r.works === null ? 'pending' : r.works || r.current?.works ? 'rejected' : 'healthy'}>{r.works === null ? 'unknown' : r.works ? 'still works' : r.current?.works ? 'rotated, still works (residual)' : 'refused'}</Pill> : <Pill kind={r.unmanaged ? 'rejected' : 'healthy'}>{r.unmanaged ? 'unmanaged' : 'managed or gone'}</Pill>}
          </div>
          {r.tried && <p className="m-0 dim">{r.tried}</p>}
          <p className="m-0">
            <code className="said-error">{r.answer}</code>
          </p>
          {r.current && (
            <p className="m-0">
              Vault&apos;s current value (<Fp v={r.current.fingerprint} />, {r.current.source}): <code className="said-error">{r.current.answer}</code>
            </p>
          )}
          <p className="m-0 dim">
            <Ago at={r.at} now={now} />
            {r.fingerprint ? (
              <>
                , fingerprint <Fp v={r.fingerprint} />
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ActRail({ act, op }) {
  return (
    <ol className="act-rail" aria-label="The acts">
      {ACTS.map((a) => {
        const state = a.n < act || (a.n === act && a.n > 0) ? 'done' : a.n === act ? 'now' : a.n === act + 1 ? 'next' : 'later';
        return (
          <li key={a.n} className={`act-rail__step act-rail__step--${state}`} aria-current={a.n === act ? 'step' : undefined}>
            <span className="act-rail__n num">{a.n}</span>
            <span className="act-rail__title">{a.title}</span>
            {state === 'next' && op.running && <span className="act-rail__busy">running</span>}
          </li>
        );
      })}
    </ol>
  );
}

export default function Scoreboard() {
  const now = useNow();
  const score = useResource('scoreboard', '/api/scoreboard', { intervalMs: 15000 });
  const witness = useResource('witness', '/api/witness', { intervalMs: 15000 });
  const plan = useResource('plan', '/api/plan');
  const reload = () => {
    score.reload();
    witness.reload();
    plan.reload();
  };
  const op = useOp(reload);
  const [open, setOpen] = useState(null);
  if (score.error?.status === 401) return <ErrorNotice error={score.error} />;
  const s = score.data?.scoreboard;
  const act = score.data?.act ?? 0;
  const latest = witness.data?.latest;
  const life = lifetime(s?.longest);
  const leak = leakWindow(s?.leak_windows?.[0]);
  const next = ACTS[act + 1];
  const tiles = s && [
    { key: 'standing', label: 'Standing secrets', value: s.standing.value, sub: s.residuals.length ? `${s.residuals.map((r) => r.id).join(', ')} is a residual` : 'machine credentials that work now', ids: s.standing.evidence.map((e) => e.id) },
    { key: 'longest', label: 'Longest remaining lifetime', value: life.text, sub: life.sub, ids: s.longest.evidence.map((e) => e.id) },
    { key: 'unmanaged', label: 'Unmanaged copies', value: s.unmanaged.value, sub: 'copies Vault does not keep current', ids: s.unmanaged.evidence.map((e) => e.id) },
    { key: 'leak', label: 'Leak window, act 0', value: leak.text, sub: leak.sub, ids: (s.leak_windows?.[0]?.evidence || []).map((e) => e.id) },
  ];

  return (
    <>
      <Hero title="Zero standing secrets" lede="Tidewell Ferries runs a plain booking app on the estate everyone has. The witness tries every machine credential for real; these numbers come only from what the targets answered.">
        {!s ? (
          <Loading label={score.data ? 'No witness run yet: one starts now' : 'Asking the witness…'} />
        ) : (
          <div className="score-grid">
            {tiles.map((t) => (
              <Tile key={t.key} label={t.label} value={t.value} sub={t.sub} onOpen={() => setOpen(t)} />
            ))}
          </div>
        )}
        <p className="hero-foot">
          Witness <Ago at={score.data?.latest?.at} now={now} />
          {score.data?.latest?.unknown?.length ? `, unknown: ${score.data.latest.unknown.join(', ')}` : ''}
        </p>
      </Hero>
      <ErrorNotice error={score.error || op.error} title="The console could not do that" />

      <section className="vg-card" aria-labelledby="rail-h">
        <div className="card-head">
          <h3 id="rail-h">The acts</h3>
          <span className="card-sub">Act {act} of 6. One class of secret per act; bookings keep working.</span>
        </div>
        <ActRail act={act} op={op} />
        {next ? (
          <div className="next-act">
            <p className="m-0">
              <strong>Act {next.n}, {next.title}</strong> removes {next.removes}. {next.how}
            </p>
            <RunButton label={`Run act ${next.n}`} busy={op.running} onClick={() => op.start(`Act ${next.n}`, `/api/acts/${next.n}/run`)} />
          </div>
        ) : (
          <p className="m-0">Every act has run. A stage reset on the Proof page brings act 0 back on purpose.</p>
        )}
      </section>
      <OpPanel op={op.op} />

      <section className="vg-card" aria-labelledby="plan-h">
        <div className="card-head">
          <h3 id="plan-h">What Terraform still has to do</h3>
          <button type="button" className="secondary-button" onClick={() => op.start('Plan', '/api/plan/refresh')} disabled={op.running}>
            <RefreshCw size={14} aria-hidden="true" /> Plan again
          </button>
        </div>
        <p className="card-sub">
          <code className="mono">make tf-plan ACT=6</code> at act {plan.data?.act ?? act}, <Ago at={plan.data?.at} now={now} />: the mounts, roles and policies the remaining acts declare.
        </p>
        {plan.data?.plan ? (
          <TableScroll label="Terraform plan">
            <pre className="plan-text">{plan.data.plan.trim()}</pre>
          </TableScroll>
        ) : (
          <p className="dim">No plan yet: Plan again.</p>
        )}
      </section>

      <Drawer open={Boolean(open)} title={open ? `${open.label}: the evidence` : ''} onClose={() => setOpen(null)}>
        {open && (
          <>
            <p className="drawer-intro">
              {open.label} is <strong>{String(open.value)}</strong>. These are the witness rows it rests on: what was tried, the answer verbatim, when, and the value&apos;s fingerprint.
            </p>
            <Evidence ids={open.ids} latest={latest} now={now} />
          </>
        )}
      </Drawer>
    </>
  );
}
