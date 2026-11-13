import { useEffect, useState } from 'react';
import { ErrorNotice, Loading, TableScroll } from '../components/ui.jsx';
import { Ago, Fp, Hero, Pill, Result, StepButton, useNow, usePlaces } from '../components/sync.jsx';
import { useResource } from '../hooks.js';

const LABELS = ['import-source', 'operation', 'owner', 'classification'];

export default function Home() {
  const places = usePlaces();
  const now = useNow();
  const events = useResource('events', '/api/events');
  const [last, setLast] = useState(null);
  useEffect(() => {
    if (!last && events.data) setLast(events.data.events.find((e) => e.act === 'home') || null);
  }, [events.data, last]);
  if (places.error?.status === 401) return <ErrorNotice error={places.error} />;
  const secrets = places.sources.data?.secrets;
  const allIn = secrets?.length > 0 && secrets.every((s) => s.vault.exists);
  const done = (e) => {
    if (e) setLast(e);
    places.reload();
  };
  return (
    <>
      <Hero places={places} title="Bring them home" lede="Secrets Import reads the legacy store and writes each secret to kv/parcel/, as Saskia. First the plan, which writes nothing; then the import." />
      <ErrorNotice error={places.error} />
      <section className="vg-card" aria-labelledby="legacy-h">
        <div className="card-head">
          <h3 id="legacy-h">The legacy store</h3>
          <span className="card-sub">AWS Secrets Manager in LocalStack, under tidewell-legacy/</span>
        </div>
        {!secrets ? (
          <Loading />
        ) : (
          <TableScroll label="The legacy secrets">
            <table className="vg-table">
              <thead>
                <tr>
                  <th scope="col">Secret</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Fingerprint</th>
                  <th scope="col">Last changed</th>
                  <th scope="col">Lands on</th>
                </tr>
              </thead>
              <tbody>
                {secrets.map((s) => (
                  <tr key={s.aws_name}>
                    <th scope="row">
                      <code>{s.aws_name}</code>
                    </th>
                    <td>{s.legacy.tags?.owner || s.owner}</td>
                    <td>{s.legacy.exists ? <Fp v={s.legacy.fingerprint} /> : <span className="dim">missing (make seed)</span>}</td>
                    <td>{s.legacy.exists ? <Ago at={s.legacy.changed} now={now} /> : null}</td>
                    <td>
                      <code>kv/{s.kv_name}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>

      <section className="vg-card" aria-labelledby="run-h">
        <div className="card-head">
          <h3 id="run-h">Plan, then import</h3>
          {allIn && <Pill kind="healthy">every secret is in Vault</Pill>}
        </div>
        <div className="actions">
          <StepButton act="home" step="plan" label="Show the plan" kind="secondary" onDone={done} />
          <StepButton act="home" step="apply" label="Import" onDone={done} />
        </div>
        <Result event={last} />
        {last?.output && (
          <div className="cli">
            <span className="card-sub">
              vault operator import {last.step}, {new Date(last.at).toLocaleTimeString()} (names only; the CLI never prints a value)
            </span>
            <pre className="said-json" tabIndex={0} aria-label="Import output">
              {last.output}
            </pre>
          </div>
        )}
      </section>

      <section className="vg-card" aria-labelledby="vault-h">
        <div className="card-head">
          <h3 id="vault-h">What Vault holds now</h3>
          <span className="card-sub">KV metadata as Vault reports it; the fingerprint is the API&apos;s, read from the legacy store at import</span>
        </div>
        {!secrets ? (
          <Loading />
        ) : (
          <TableScroll label="The imported secrets">
            <table className="vg-table">
              <thead>
                <tr>
                  <th scope="col">Path</th>
                  <th scope="col">Version</th>
                  <th scope="col">Labels</th>
                  <th scope="col">Fingerprint</th>
                </tr>
              </thead>
              <tbody>
                {secrets.map((s) => (
                  <tr key={s.kv_name}>
                    <th scope="row">
                      <code>kv/{s.kv_name}</code>
                    </th>
                    {s.vault.exists ? (
                      <>
                        <td className="num">
                          {s.vault.current_version} <span className="dim">(<Ago at={s.vault.updated} now={now} />)</span>
                        </td>
                        <td>
                          <span className="labels">
                            {LABELS.filter((k) => s.vault.labels[k]).map((k) => (
                              <code key={k}>
                                {k}={s.vault.labels[k]}
                              </code>
                            ))}
                          </span>
                        </td>
                        <td>
                          <span className="cell-stack">
                            <Fp v={s.vault.fingerprint} />
                            {s.vault.fingerprint && s.legacy.fingerprint && (s.vault.fingerprint === s.legacy.fingerprint ? <Pill kind="healthy">same as the legacy store</Pill> : <Pill kind="approved">changed in Vault since</Pill>)}
                          </span>
                        </td>
                      </>
                    ) : (
                      <td colSpan={3}>
                        <span className="dim">not pulled yet</span>
                      </td>
                    )}
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
