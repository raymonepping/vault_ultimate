// components/sync.jsx: the console's own pieces. The two-way map is the
// signature element: the legacy store pulls INTO Vault (Secrets Import), Vault
// pushes OUT to GitHub Actions and the AWS-shaped store (Secrets Sync). Each
// arrow carries the state Vault reports and the time of the last change.
import { useEffect, useState } from 'react';
import { Archive, Cloud, Vault as VaultIcon, ArrowRight } from 'lucide-react';
import { call } from '../api.js';
import { useResource } from '../hooks.js';
import { ErrorNotice, tidy } from './ui.jsx';
import { LINKS } from './Footer.jsx';

// lucide has no brand marks: the footer's authored GitHub path.
const Github = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d={LINKS[0].path} />
  </svg>
);

// Vault's sync_status as a pill. Text on its own tint is AA (vault-glass.css).
const SYNC = {
  SYNCED: ['healthy', 'synced'],
  FAILED: ['rejected', 'failed'],
  UNSYNC_FAILED: ['rejected', 'removal failed'],
  INTERNAL_VAULT_ERROR: ['rejected', 'Vault error'],
  CLIENT_SIDE_ERROR: ['rejected', 'refused by the destination'],
};
export function syncState(a) {
  if (!a) return { kind: 'none', text: 'not associated' };
  const [kind, text] = SYNC[a.sync_status] || ['pending', String(a.sync_status || 'pending').toLowerCase().replace(/_/g, ' ')];
  return { kind, text };
}
export function Pill({ kind, children }) {
  return <span className={`vg-pill vg-pill--${kind}`}>{children}</span>;
}

// A value is never on screen: its fingerprint is (first 8 hex of SHA-256).
export function Fp({ v, label = 'fingerprint' }) {
  if (!v) return <span className="dim">none</span>;
  return (
    <code className="fp" title={`${label}: first 8 hex of SHA-256 of the value`}>
      {v}
    </code>
  );
}

export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
export function Ago({ at, now }) {
  if (!at) return <span className="dim">never</span>;
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  const text = s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(at).toLocaleDateString();
  return (
    <time dateTime={at} title={new Date(at).toLocaleString()}>
      {text}
    </time>
  );
}

// Every place a secret lives, polled together (the API reads Vault and
// LocalStack as the presenter; GitHub's evidence file as written on the host).
export function usePlaces(intervalMs = 4000) {
  const story = useResource('story', '/api/story');
  const sync = useResource('sync', '/api/sync', { intervalMs });
  const sources = useResource('sources', '/api/sources', { intervalMs });
  const reload = () => Promise.all([story.reload(), sync.reload(), sources.reload()]);
  return { story, sync, sources, reload, error: story.error || sync.error || sources.error };
}

// One step of an act. Vault's refusal is shown verbatim; the event goes to
// the "Vault said" drawer through api.js.
export function StepButton({ act, step, label, kind = 'primary', disabled, onDone }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await call(label, `/api/acts/${act}/${step}`, { method: 'POST' });
      onDone?.(r.event);
    } catch (e) {
      setError(e);
      onDone?.(null);
    } finally {
      setRunning(false);
    }
  };
  return (
    <span className="step">
      <button type="button" className={`${kind}-button`} onClick={run} disabled={disabled || running}>
        {running ? 'Asking Vault…' : label}
      </button>
      {error && <ErrorNotice error={error} title={`${label}: refused`} />}
    </span>
  );
}

// The last event of a step, as a short result line with Vault's errors.
export function Result({ event }) {
  if (!event) return null;
  const errors = (event.said || []).flatMap((s) => s.errors).map(tidy);
  return (
    <div className={`inline-notice ${event.ok ? 'success' : 'error'}`} role="status">
      <strong>{event.ok ? 'Done' : 'Refused'}</strong> {event.summary}
      {errors.length > 0 && (
        <ul className="vault-errors">
          {errors.map((x) => (
            <li key={x}>
              Vault said: <code>{x}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const icons = { legacy: Archive, vault: VaultIcon, github: Github, localstack: Cloud };

function Node({ id, title, sub, children }) {
  const Icon = icons[id];
  return (
    <div className={`map-node map-node--${id}`}>
      <div className="map-node__head">
        <Icon aria-hidden="true" />
        <span className="map-node__title">{title}</span>
      </div>
      <span className="map-node__sub">{sub}</span>
      {children}
    </div>
  );
}

function Arrow({ dir, label, state, at, now }) {
  return (
    <div className={`map-arrow map-arrow--${dir}`}>
      <span className="map-arrow__line" aria-hidden="true">
        <ArrowRight />
      </span>
      <span className="map-arrow__label">{label}</span>
      <Pill kind={state.kind}>{state.text}</Pill>
      {now && <span className="map-arrow__when">{at ? <Ago at={at} now={now} /> : 'no change yet'}</span>}
    </div>
  );
}

// The two-way map. compact: the small version that heads every act page.
export function SyncMap({ places, compact = false }) {
  const now = useNow();
  const st = places.story.data;
  const secrets = places.sources.data?.secrets || [];
  const dests = places.sync.data?.destinations || {};
  const kv = st?.sync?.secret;
  const imported = secrets.filter((s) => s.vault.exists);
  const pull =
    !secrets.length ? { kind: 'none', text: 'checking' } : imported.length === secrets.length ? { kind: 'healthy', text: `pulled ${imported.length} of ${secrets.length}` } : imported.length ? { kind: 'pending', text: `pulled ${imported.length} of ${secrets.length}` } : { kind: 'none', text: 'not pulled yet' };
  const pulledAt = imported.map((s) => s.vault.created).sort().at(-1);
  const assoc = (key) => (dests[key]?.associations || []).find((a) => a.secret_name === kv);
  return (
    <figure className={`sync-map${compact ? ' sync-map--compact' : ''}`} aria-label="Where the secrets live: pulled into Vault, pushed out to two destinations">
      <Node id="legacy" title="Legacy store" sub="AWS Secrets Manager (LocalStack)">
        {!compact && <span className="map-node__fact">{secrets.filter((s) => s.legacy.exists).length} secrets under tidewell-legacy/</span>}
      </Node>
      <Arrow dir="in" label="Secrets Import" state={pull} at={pulledAt} now={compact ? null : now} />
      <Node id="vault" title="Vault" sub="kv/parcel/ in namespace tidewell">
        {!compact && <span className="map-node__fact">system of record: {imported.length} secrets</span>}
      </Node>
      <div className="map-out">
        {['github', 'localstack'].map((key) => (
          <div className="map-out__row" key={key}>
            <Arrow dir="out" label="Secrets Sync" state={syncState(assoc(key))} at={assoc(key)?.updated_at} now={compact ? null : now} />
            <Node id={key} title={key === 'github' ? 'GitHub Actions' : 'AWS copy'} sub={key === 'github' ? 'raymonepping/vault_ultimate' : 'vault/tidewell/ (LocalStack)'} />
          </div>
        ))}
      </div>
      {!compact && kv && (
        <figcaption className="map-caption">
          The arrows out show Vault&apos;s own status for <code>{kv}</code>.
        </figcaption>
      )}
    </figure>
  );
}

// Each page's single ink pane: its title, one or two sentences, and the map.
export function Hero({ title, lede, places, compact = true, children }) {
  return (
    <section className="vg-hero sync-hero" aria-labelledby="hero-h">
      <div className="sync-hero__text">
        <h2 id="hero-h" className="hero-title">
          {title}
        </h2>
        <p className="hero-lede">{lede}</p>
        {children}
      </div>
      <SyncMap places={places} compact={compact} />
    </section>
  );
}
