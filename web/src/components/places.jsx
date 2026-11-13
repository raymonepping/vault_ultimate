// components/places.jsx: each legacy secret in every place it lives, as
// fingerprints. A copy that differs from Vault says so; GitHub's evidence
// that predates Vault's last sync says "stale", never "present".
import { Ago, Fp, Pill } from './sync.jsx';
import { TableScroll } from './ui.jsx';

export function Match({ a, b }) {
  if (!a || !b) return null;
  return a === b ? <Pill kind="healthy">matches Vault</Pill> : <Pill kind="rejected">differs from Vault</Pill>;
}

export function GithubCell({ g, now }) {
  if (g.state === 'unknown') return <span className="dim">{g.reason}</span>;
  if (g.state === 'absent') return <Pill kind="none">absent</Pill>;
  return (
    <span className="cell-stack">
      <Pill kind={g.state === 'stale' ? 'pending' : 'healthy'}>{g.state === 'stale' ? 'stale: read before the last sync' : 'present'}</Pill>
      {g.updated_at && (
        <span className="dim">
          updated <Ago at={g.updated_at} now={now} />
        </span>
      )}
    </span>
  );
}

export function PlacesTable({ secrets, now }) {
  return (
    <TableScroll label="Where each secret lives">
      <table className="vg-table">
        <thead>
          <tr>
            <th scope="col">Secret</th>
            <th scope="col">Legacy store</th>
            <th scope="col">Vault</th>
            <th scope="col">AWS copy</th>
            <th scope="col">GitHub Actions</th>
          </tr>
        </thead>
        <tbody>
          {secrets.map((s) => (
            <tr key={s.kv_name}>
              <th scope="row">
                <span className="cell-stack">
                  <code>kv/{s.kv_name}</code>
                  <span className="dim">{s.owner}</span>
                </span>
              </th>
              <td>{s.legacy.exists ? <Fp v={s.legacy.fingerprint} /> : <span className="dim">gone</span>}</td>
              <td>
                {s.vault.exists ? (
                  <span className="cell-stack">
                    <span className="num">version {s.vault.current_version}</span>
                    <Fp v={s.vault.fingerprint} />
                  </span>
                ) : (
                  <span className="dim">{s.vault.error || 'not pulled yet'}</span>
                )}
              </td>
              <td>
                {s.localstack_copy.exists ? (
                  <span className="cell-stack">
                    <Fp v={s.localstack_copy.fingerprint} />
                    <Match a={s.localstack_copy.fingerprint} b={s.vault.fingerprint} />
                  </span>
                ) : (
                  <span className="dim">not pushed</span>
                )}
              </td>
              <td>
                <GithubCell g={s.github} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
