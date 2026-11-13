import { useState } from 'react';
import { ErrorNotice, Loading } from '../components/ui.jsx';
import { Ago, Fp, Hero, Pill, Result, StepButton, syncState, useNow, usePlaces } from '../components/sync.jsx';
import { GithubCell, Match } from '../components/places.jsx';

export default function Change() {
  const places = usePlaces(3000);
  const now = useNow(2000);
  const [last, setLast] = useState(null);
  if (places.error?.status === 401) return <ErrorNotice error={places.error} />;
  const kv = places.story.data?.rotate;
  const s = places.sources.data?.secrets.find((x) => x.kv_name === kv);
  const dests = places.sync.data?.destinations || {};
  const assoc = (k) => (dests[k]?.associations || []).find((a) => a.secret_name === kv);
  return (
    <>
      <Hero places={places} title="Change once" lede="Rotate the delivery key in Vault and watch it land. The API generates the new value and writes it as Saskia; Secrets Sync pushes it to both destinations. The value is never on screen, its fingerprint is." />
      <ErrorNotice error={places.error} />
      <section className="vg-card" aria-labelledby="rot-h">
        <div className="card-head">
          <h3 id="rot-h">
            Rotate <code>kv/{kv}</code>
          </h3>
          <StepButton act="change" step="rotate" label="Rotate the delivery key" onDone={(e) => { if (e) setLast(e); places.reload(); }} />
        </div>
        <Result event={last} />
        {!s ? (
          <Loading />
        ) : (
          <div className="places">
            <article className="place" aria-labelledby="pl-vault">
              <h4 id="pl-vault">Vault</h4>
              {s.vault.exists ? (
                <dl className="facts">
                  <dt>Version</dt>
                  <dd className="num">{s.vault.current_version}</dd>
                  <dt>Fingerprint</dt>
                  <dd>
                    <Fp v={s.vault.fingerprint} />
                  </dd>
                  <dt>Changed</dt>
                  <dd>
                    <Ago at={s.vault.updated} now={now} />
                    {s.vault.labels.rotated_by && <span className="dim"> by {s.vault.labels.rotated_by}</span>}
                  </dd>
                </dl>
              ) : (
                <p className="dim">Not in Vault yet: bring it home first.</p>
              )}
            </article>
            <article className="place" aria-labelledby="pl-aws">
              <h4 id="pl-aws">AWS copy</h4>
              <dl className="facts">
                <dt>Vault says</dt>
                <dd>
                  <Pill kind={syncState(assoc('localstack')).kind}>{syncState(assoc('localstack')).text}</Pill>
                </dd>
                <dt>Fingerprint</dt>
                <dd>
                  {s.localstack_copy.exists ? (
                    <span className="cell-stack">
                      <Fp v={s.localstack_copy.fingerprint} />
                      <Match a={s.localstack_copy.fingerprint} b={s.vault.fingerprint} />
                    </span>
                  ) : (
                    <span className="dim">not pushed</span>
                  )}
                </dd>
                <dt>Changed</dt>
                <dd>{s.localstack_copy.exists ? <Ago at={s.localstack_copy.changed} now={now} /> : null}</dd>
              </dl>
            </article>
            <article className="place" aria-labelledby="pl-gh">
              <h4 id="pl-gh">GitHub Actions</h4>
              <dl className="facts">
                <dt>Vault says</dt>
                <dd>
                  <Pill kind={syncState(assoc('github')).kind}>{syncState(assoc('github')).text}</Pill>
                  {assoc('github') && (
                    <span className="dim">
                      {' '}
                      <Ago at={assoc('github').updated_at} now={now} />
                    </span>
                  )}
                </dd>
                <dt>GitHub says</dt>
                <dd>
                  <GithubCell g={s.github} now={now} />
                </dd>
                <dt>Name</dt>
                <dd>
                  <code>{s.github.name}</code>
                </dd>
              </dl>
            </article>
          </div>
        )}
      </section>
    </>
  );
}
