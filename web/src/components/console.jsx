// components/console.jsx: the console's own pieces. A wave runs on the host
// (the API asks the runner); RunButton starts one and OpPanel follows it to
// the end, with the runner's redacted output.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { call } from '../api.js';

export function Pill({ kind, children }) {
  return <span className={`vg-pill vg-pill--${kind}`}>{children}</span>;
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

// A fingerprint: the first 8 hex of SHA-256, never the value.
export function Fp({ v }) {
  if (!v) return <span className="dim">none</span>;
  return (
    <code className="mono fp" title="first 8 hex of SHA-256; never the value">
      {v}
    </code>
  );
}

// The page's one ink pane.
export function Hero({ title, lede, children }) {
  return (
    <section className="vg-hero console-hero" aria-labelledby="hero-h">
      <div className="console-hero__text">
        <h2 id="hero-h" className="hero-title">
          {title}
        </h2>
        {lede && <p className="hero-lede">{lede}</p>}
      </div>
      {children}
    </section>
  );
}

// The runner's operation: polled while it runs, then onDone().
export function useOp(onDone) {
  const [op, setOp] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);
  const done = useRef(onDone);
  done.current = onDone;
  const poll = useCallback(async () => {
    clearTimeout(timer.current);
    try {
      const r = await call('Runner', '/api/op', { quiet: true });
      setOp(r.op);
      if (r.op?.state === 'running') timer.current = setTimeout(poll, 1500);
      else done.current?.(r.op);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    poll();
    return () => clearTimeout(timer.current);
  }, [poll]);
  const start = async (label, path, body) => {
    setError(null);
    try {
      await call(label, path, { method: 'POST', body });
      poll();
    } catch (e) {
      setError(e);
    }
  };
  return { op, error, start, running: op?.state === 'running' };
}

const STATE = { running: 'pending', succeeded: 'healthy', failed: 'rejected', 'timed-out': 'rejected' };

export function OpPanel({ op, title = 'On the host' }) {
  if (!op) return null;
  const lines = (op.lines || []).filter((l) => l.trim()).slice(-14);
  return (
    <section className="vg-card op-panel" aria-labelledby="op-h" aria-live="polite">
      <div className="card-head">
        <h3 id="op-h">{title}</h3>
        <span className="op-head">
          <code className="mono">make {op.action}</code> <Pill kind={STATE[op.state] || 'none'}>{op.state}</Pill>{' '}
          <span className="dim">{Math.round(op.durationMs / 1000)} s</span>
        </span>
      </div>
      {lines.length > 0 && (
        <pre className="op-lines" tabIndex={0} aria-label={`Output of make ${op.action}`}>
          {lines.join('\n')}
        </pre>
      )}
    </section>
  );
}

export function RunButton({ label, onClick, disabled, busy, kind = 'primary' }) {
  return (
    <button type="button" className={kind === 'primary' ? 'primary-button' : kind === 'danger' ? 'destructive-button' : 'secondary-button'} onClick={onClick} disabled={disabled || busy}>
      {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Play size={14} aria-hidden="true" />} {label}
    </button>
  );
}
