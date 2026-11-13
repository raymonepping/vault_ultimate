// pages/Witness.jsx: every try the witness made, with the answer verbatim,
// when, and the value's fingerprint (never the value); the copies; the
// residual with its reason.
import { useResource } from '../hooks.js';
import { ErrorNotice, Loading, TableScroll } from '../components/ui.jsx';
import { Hero, Pill, Ago, Fp, useNow, useOp, OpPanel, RunButton } from '../components/console.jsx';
import { duration } from '../format.js';

const verdict = (w) => (w === null ? ['pending', 'unknown'] : w ? ['rejected', 'still works'] : ['healthy', 'refused']);
const life = (l) => (!l ? '' : l.never ? 'never ends' : l.until ? `until ${new Date(l.until).toLocaleString()}` : '');

export default function Witness() {
  const now = useNow();
  const w = useResource('witness', '/api/witness', { intervalMs: 15000 });
  const op = useOp(() => w.reload());
  if (w.error?.status === 401) return <ErrorNotice error={w.error} />;
  const l = w.data?.latest;
  return (
    <>
      <Hero title="The witness" lede="One real try per machine credential, with the lab's own record of it: a PostgreSQL login, an LDAP bind, a Keycloak client grant, the agent's key on the booking API, the deploy check, and a TLS handshake with an OCSP request to Vault. A target that does not answer is unknown, never refused.">
        <div className="hero-actions">
          <RunButton label="Run the witness now" busy={op.running} onClick={() => op.start('Witness', '/api/witness/run')} />
          <span className="hero-foot">
            Last run <Ago at={l?.at} now={now} />
            {l ? `, act ${l.act}` : ''}
          </span>
        </div>
      </Hero>
      <ErrorNotice error={w.error || op.error} />
      <OpPanel op={op.op} />
      {!l ? (
        <Loading label="No witness run yet" />
      ) : (
        <>
          <section className="vg-card" aria-labelledby="creds-h">
            <div className="card-head">
              <h3 id="creds-h">Credentials</h3>
              <span className="card-sub">
                Standing {l.standing}, unknown {l.unknown?.length ?? 0}
              </span>
            </div>
            <TableScroll label="Credentials the witness tried">
              <table className="vg-table">
                <thead>
                  <tr>
                    <th scope="col">Credential</th>
                    <th scope="col">Now</th>
                    <th scope="col">What the target answered</th>
                    <th scope="col">Lifetime</th>
                    <th scope="col">Fingerprint</th>
                  </tr>
                </thead>
                <tbody>
                  {l.credentials.map((c) => {
                    const [k, t] = verdict(c.works);
                    return (
                      <tr key={c.id}>
                        <td>
                          <div className="cell-stack">
                            <code className="mono">{c.id}</code>
                            <span className="dim">{c.label}</span>
                          </div>
                        </td>
                        <td>
                          <Pill kind={k}>{t}</Pill>
                          {c.residual && <span className="dim"> residual</span>}
                        </td>
                        <td>
                          <div className="cell-stack">
                            <code className="said-error">{c.answer}</code>
                            <span className="dim">{c.tried}</span>
                            {c.current && (
                              <span>
                                Vault&apos;s current value (<Fp v={c.current.fingerprint} />): <code className="said-error">{c.current.answer}</code>
                              </span>
                            )}
                            {c.replaced_by?.lifetime && <span className="dim">Replaced by: {c.replaced_by.lifetime.source}, {life(c.replaced_by.lifetime)}</span>}
                          </div>
                        </td>
                        <td>{life(c.lifetime) || <span className="dim">none</span>}</td>
                        <td>
                          <Fp v={c.fingerprint} />
                        </td>
                      </tr>
                    );
                  })}
                  {l.extras.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="cell-stack">
                          <code className="mono">{c.id}</code>
                          <span className="dim">{c.label}</span>
                        </div>
                      </td>
                      <td>
                        <Pill kind={verdict(c.works)[0]}>{verdict(c.works)[1]}</Pill>
                      </td>
                      <td>
                        <div className="cell-stack">
                          <code className="said-error">{c.answer}</code>
                          <span className="dim">{c.tried}</span>
                        </div>
                      </td>
                      <td>
                        <span className="dim">single use</span>
                      </td>
                      <td>
                        <Fp v={c.fingerprint} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>

          <section className="vg-card" aria-labelledby="copies-h">
            <div className="card-head">
              <h3 id="copies-h">Copies outside Vault</h3>
              <span className="card-sub">Unmanaged {l.unmanaged}: a copy counts while what it holds works and Vault does not keep it current</span>
            </div>
            <TableScroll label="Copies">
              <table className="vg-table">
                <thead>
                  <tr>
                    <th scope="col">Copy</th>
                    <th scope="col">State</th>
                    <th scope="col">What its system says</th>
                  </tr>
                </thead>
                <tbody>
                  {l.copies.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <code className="mono">{c.id}</code>
                      </td>
                      <td>
                        <Pill kind={c.unmanaged ? 'rejected' : c.managed ? 'healthy' : 'none'}>{c.unmanaged ? 'unmanaged' : c.managed ? 'Vault keeps it current' : 'gone'}</Pill>
                      </td>
                      <td>{c.answer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>

          {l.credentials
            .filter((c) => c.residual)
            .map((c) => (
              <section key={c.id} className="vg-card" aria-labelledby={`res-${c.id}`}>
                <h3 id={`res-${c.id}`}>Residual: {c.id}</h3>
                <p className="m-0">{c.residual_reason}</p>
              </section>
            ))}
          {l.longest && !l.longest.never && l.longest.seconds !== null && (
            <p className="dim">Longest remaining lifetime of what works now: {duration(l.longest.seconds)}.</p>
          )}
        </>
      )}
    </>
  );
}
