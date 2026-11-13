import { useState } from 'react';
import { ErrorNotice, Loading, TableScroll } from '../components/ui.jsx';
import { Ago, Hero, Pill, Result, StepButton, syncState, useNow, usePlaces } from '../components/sync.jsx';
import { GithubCell } from '../components/places.jsx';

function Destination({ k, d, secret, now, onDone, last }) {
  const a = d.associations.find((x) => x.secret_name === secret);
  return (
    <section className="vg-card" aria-labelledby={`dest-${k}`}>
      <div className="card-head">
        <h3 id={`dest-${k}`}>{d.label}</h3>
        <Pill kind={d.found ? 'local' : 'rejected'}>{d.found ? d.type : 'missing'}</Pill>
      </div>
      {d.found ? (
        <dl className="facts">
          <dt>Destination</dt>
          <dd>
            <code>{d.name}</code>
          </dd>
          <dt>Name template</dt>
          <dd>
            <code>{d.options?.secret_name_template}</code>
          </dd>
          <dt>Granularity</dt>
          <dd>{d.options?.granularity_level}</dd>
        </dl>
      ) : (
        <p className="inline-notice error">Vault said: {d.error}</p>
      )}
      <div className="actions">
        <StepButton act="out" step={k} label={`Push ${secret}`} disabled={!d.found} onDone={onDone} />
        <StepButton act="letgo" step={k} label="Remove the association" kind="destructive" disabled={!a} onDone={onDone} />
      </div>
      {last && <Result event={last} />}
      <TableScroll label={`Secrets ${d.name} carries`}>
        <table className="vg-table">
          <thead>
            <tr>
              <th scope="col">Secret</th>
              <th scope="col">Vault&apos;s status</th>
              <th scope="col">Last change</th>
            </tr>
          </thead>
          <tbody>
            {d.associations.length === 0 ? (
              <tr>
                <td colSpan={3}>
                  <span className="dim">Nothing is pushed here.</span>
                </td>
              </tr>
            ) : (
              d.associations.map((x) => (
                <tr key={x.secret_name}>
                  <th scope="row">
                    <code>
                      {x.mount}/{x.secret_name}
                    </code>
                  </th>
                  <td>
                    <span className="cell-stack">
                      <Pill kind={syncState(x).kind}>{syncState(x).text}</Pill>
                      {x.error && <code className="said-error">{x.error}</code>}
                    </span>
                  </td>
                  <td>
                    <Ago at={x.updated_at} now={now} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableScroll>
    </section>
  );
}

export default function Out() {
  const places = usePlaces();
  const now = useNow();
  const [last, setLast] = useState({});
  if (places.error?.status === 401) return <ErrorNotice error={places.error} />;
  const dests = places.sync.data?.destinations;
  const secret = places.story.data?.sync?.secret;
  const src = places.sources.data;
  const row = src?.secrets.find((s) => s.kv_name === secret);
  return (
    <>
      <Hero places={places} title="Send them out" lede="Secrets Sync keeps a copy of a Vault secret where a workload reads it. Push the delivery key to GitHub Actions and to the AWS copy; remove the association and Vault deletes the copy." />
      <ErrorNotice error={places.error} />
      {!dests || !secret ? (
        <Loading />
      ) : (
        <div className="grid-2">
          {Object.entries(dests).map(([k, d]) => (
            <Destination
              key={k}
              k={k}
              d={d}
              secret={secret}
              now={now}
              last={last[k]}
              onDone={(e) => {
                if (e) setLast((l) => ({ ...l, [k]: e }));
                places.reload();
              }}
            />
          ))}
        </div>
      )}
      <section className="vg-card" aria-labelledby="gh-h">
        <div className="card-head">
          <h3 id="gh-h">What GitHub itself says</h3>
          <span className="card-sub">
            Names and update times from <code>gh secret list</code> (GitHub has no API for values). Refresh on the Mac with <code>make github-evidence</code>.
          </span>
        </div>
        {!src ? (
          <Loading />
        ) : (
          <dl className="facts">
            <dt>Read</dt>
            <dd>{src.evidence_read_at ? <Ago at={src.evidence_read_at} now={now} /> : <span className="dim">{src.evidence_missing}</span>}</dd>
            {row && (
              <>
                <dt>
                  <code>{row.github.name}</code>
                </dt>
                <dd>
                  <GithubCell g={row.github} now={now} />
                </dd>
              </>
            )}
          </dl>
        )}
      </section>
    </>
  );
}
