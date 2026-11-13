import { ErrorNotice, Loading, tidy } from '../components/ui.jsx';
import { Ago, Hero, Pill, useNow, usePlaces } from '../components/sync.jsx';
import { useResource } from '../hooks.js';

const STEP = { 'home/plan': 'Showed the import plan', 'home/apply': 'Imported', 'out/github': 'Pushed to GitHub', 'out/localstack': 'Pushed to the AWS copy', 'change/rotate': 'Rotated', 'letgo/github': 'Removed from GitHub', 'letgo/localstack': 'Removed from the AWS copy' };

export default function Proof() {
  const places = usePlaces(10000);
  const events = useResource('events', '/api/events', { intervalMs: 5000 });
  const now = useNow();
  if (events.error?.status === 401) return <ErrorNotice error={events.error} />;
  const list = events.data?.events;
  return (
    <>
      <Hero places={places} title="What happened" lede="Every step this console ran, newest first, as Saskia. Each carries a correlation id that Vault's audit log records next to her name, and Vault's own answers." />
      <ErrorNotice error={events.error} />
      <section className="vg-card" aria-labelledby="ev-h">
        <div className="card-head">
          <h3 id="ev-h">Steps</h3>
          <span className="card-sub">The last 200, kept in the API&apos;s memory; make stage-reset clears them</span>
        </div>
        {!list ? (
          <Loading />
        ) : list.length === 0 ? (
          <p className="dim">Nothing yet. Start with Bring home.</p>
        ) : (
          <ol className="events">
            {list.map((e) => (
              <li key={e.id} className="event">
                <div className="event__head">
                  <Pill kind={e.ok ? 'healthy' : 'rejected'}>{e.ok ? 'done' : 'refused'}</Pill>
                  <strong>{STEP[`${e.act}/${e.step}`] || `${e.act}/${e.step}`}</strong>
                  <span className="dim">
                    by {e.who}, <Ago at={e.at} now={now} />
                  </span>
                </div>
                <p>{e.summary}</p>
                <details>
                  <summary>
                    Vault said <code>{e.id}</code>
                  </summary>
                  {e.said.length > 0 && (
                    <ul className="said-steps">
                      {e.said.map((v, i) => (
                        <li key={`${v.path}-${i}`}>
                          <span className={`said-status ${v.status < 300 ? 'ok' : 'bad'}`}>Vault {v.status}</span> <code>{v.method} {v.path}</code>
                          {v.errors.map((x) => (
                            <code key={x} className="said-error">
                              {tidy(x)}
                            </code>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}
                  {e.output && (
                    <pre className="said-json" tabIndex={0} aria-label={`Output of ${e.id}`}>
                      {e.output}
                    </pre>
                  )}
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
