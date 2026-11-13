// App.jsx: the shell (from vault_governor and vault_codex). Frosted rail, floating
// topbar, the pages as hash routes, left/right arrows between pages, ? for the
// shortcuts, and the "Vault said" drawer with every API answer this page got.
import { useCallback, useEffect, useState } from 'react';
import { Gauge, ListOrdered, Eye, Siren, History, ScrollText, LogOut, UserRound, ExternalLink, PanelLeftClose, PanelLeftOpen, Keyboard } from 'lucide-react';
import { call } from './api.js';
import { useResource, useRoute, useVaultLog } from './hooks.js';
import { AuthContext, Drawer, tidy } from './components/ui.jsx';
import Footer from './components/Footer.jsx';
import Scoreboard from './pages/Scoreboard.jsx';
import Acts from './pages/Acts.jsx';
import Witness from './pages/Witness.jsx';
import Investigation from './pages/Investigation.jsx';
import Proof from './pages/Proof.jsx';

export const PAGES = [
  { id: 'scoreboard', label: 'Scoreboard', title: 'Zero standing secrets', icon: Gauge, Page: Scoreboard },
  { id: 'acts', label: 'Acts', title: 'The acts', icon: ListOrdered, Page: Acts },
  { id: 'witness', label: 'Witness', title: 'The witness', icon: Eye, Page: Witness },
  { id: 'investigation', label: 'Investigation', title: 'The revocation drill', icon: Siren, Page: Investigation },
  { id: 'proof', label: 'Proof', title: 'What happened', icon: History, Page: Proof },
];

function Brand() {
  return (
    <svg className="brand-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 2l12 7v14l-12 7-12-7V9z" fill="currentColor" />
      <circle cx="16" cy="14" r="3.2" fill="none" stroke="#fff" strokeWidth="1.8" />
      <path d="M16 17.2v5.6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const FOLD_KEY = 'vult.sidebar.collapsed';
function readFolded() {
  try {
    return window.localStorage.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
}
function writeFolded(v) {
  try {
    window.localStorage.setItem(FOLD_KEY, v ? '1' : '0');
  } catch {
    /* not remembered, still works */
  }
}

function NavLinks({ route, className, folded = false }) {
  return PAGES.map(({ id, label, icon: Icon }) => (
    <a key={id} href={`#/${id}`} className={`${className}${route === id ? ' active' : ''}`} aria-current={route === id ? 'page' : undefined} title={folded ? label : undefined}>
      <span className="nav-icon">
        <Icon aria-hidden="true" />
      </span>
      <span className="nav-label">{label}</span>
    </a>
  ));
}

// Vault, the booking app and the host runner, from /api/status (needs the session).
function ClusterPill({ status, signedIn }) {
  const h = status.data;
  const usable = h?.nodes?.filter((n) => n.reachable && !n.sealed).length || 0;
  const appOk = h?.booking?.database === 'up';
  const runnerOk = h?.runner?.up;
  const state = !signedIn ? 'unknown' : status.error ? 'critical' : !h ? 'unknown' : usable === 3 && appOk && runnerOk ? 'healthy' : usable ? 'pending' : 'critical';
  const version = h?.nodes?.find((n) => n.version)?.version;
  const text = !signedIn ? 'signed out' : status.error ? 'API unreachable' : !h ? 'checking' : `act ${h.act}, ${usable}/3 unsealed${version ? `, ${version}` : ''}${appOk ? '' : ', bookings down'}${runnerOk ? '' : ', runner down'}`;
  return (
    <span className={`cluster-pill ${state}`} role="status" aria-live="polite">
      <span className={`cluster-dot${state === 'healthy' ? ' live' : ''}`} aria-hidden="true" />
      <span className="cluster-label">{text}</span>
    </span>
  );
}

function Person({ me, onSignOut }) {
  const [open, setOpen] = useState(false);
  if (!me?.signedIn) return null;
  return (
    <div className="user-menu">
      <button type="button" className="persona" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="persona-dot persona-dot--auth" aria-hidden="true" />
        <UserRound size={13} aria-hidden="true" />
        <span>{me.user}</span>
      </button>
      {open && (
        <div className="user-menu-panel" role="dialog" aria-label="Signed in">
          <div className="umf-row umf-user">{me.display || me.user}, {(me.role || 'platform engineer').toLowerCase()}</div>
          <div className="umf-row umf-meta">Entity {me.entity_id}</div>
          <button type="button" className="umf-signout" onClick={onSignOut}>
            <LogOut size={12} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ←/→ between pages (not while typing), ? for the shortcuts.
function useKeys(route, onHelp) {
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('dialog[open], .vg-drawer'))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // The URL, not React state: a second key can arrive before the re-render.
      const current = window.location.hash.replace(/^#\/?/, '').split(/[?/]/)[0] || route;
      const i = Math.max(0, PAGES.findIndex((p) => p.id === current));
      if (e.key === 'ArrowRight' && i < PAGES.length - 1) window.location.hash = `#/${PAGES[i + 1].id}`;
      else if (e.key === 'ArrowLeft' && i > 0) window.location.hash = `#/${PAGES[i - 1].id}`;
      else if (e.key === '?') onHelp();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, onHelp]);
}

// One API answer: the event it made (who, Vault's status, its errors
// verbatim, the correlation id), or the refusal.
function SaidEntry({ e }) {
  const v = e.body?.event?.vault;
  const said = v ? [{ method: '', path: e.body.event.what, status: v.status, as: e.body.event.by, errors: v.errors || [] }] : [];
  const ok = e.status >= 200 && e.status < 300;
  return (
    <li className="said-item">
      <div className="said-head">
        <strong>{e.label}</strong>
        <span className={`said-status ${ok ? 'ok' : 'bad'}`}>HTTP {e.status || '-'}</span>
      </div>
      <code className="said-path">
        {e.method} {e.path}
      </code>
      {said.length > 0 && (
        <ol className="said-steps">
          {said.map((v, i) => (
            <li key={`${v.path}-${i}`}>
              <span className={`said-status ${v.status < 300 ? 'ok' : 'bad'}`}>Vault {v.status}</span> <code>{v.method} {v.path}</code> <span className="dim">as {v.as}</span>
              {v.errors.map((x) => (
                <code key={x} className="said-error">
                  {tidy(x)}
                </code>
              ))}
            </li>
          ))}
        </ol>
      )}
      {e.body?.event?.correlation_id && (
        <p className="m-0 dim">
          correlation id <code className="mono">{e.body.event.correlation_id}</code>
        </p>
      )}
      {!ok && e.body?.error && <p className="m-0">{e.body.error}</p>}
    </li>
  );
}

export default function App() {
  const route = useRoute(PAGES.map((p) => p.id), 'scoreboard');
  const page = PAGES.find((p) => p.id === route);
  const me = useResource('session', '/api/session');
  // GET /api/session answers 401 when nobody is signed in: that is "signed out".
  const signedIn = Boolean(me.data?.user) && me.error?.status !== 401;
  const status = useResource('status', '/api/status', { intervalMs: 15000 });
  const log = useVaultLog();
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const [folded, setFolded] = useState(readFolded);
  const onHelp = useCallback(() => setHelp(true), []);
  useKeys(route, onHelp);
  useEffect(() => {
    document.title = `${page.title}: Tidewell Ferries console`;
  }, [page]);
  const auth = { ...(signedIn ? me.data : {}), signedIn, refresh: () => { me.reload(); status.reload(); } };
  const signOut = async () => {
    await call('Sign out', '/api/session/end', { method: 'POST' }).catch(() => {});
    me.reload();
  };
  const toggleFold = () =>
    setFolded((f) => {
      writeFolded(!f);
      return !f;
    });

  return (
    <AuthContext.Provider value={auth}>
      <div className="vg-shell">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <aside className={`vg-sidebar${folded ? ' collapsed' : ''}`} aria-label="Pages">
          <div className="sidebar-brand">
            <Brand />
            <span className="brand-name">Tidewell Ferries</span>
          </div>
          <nav className="sidebar-nav" id="rail-nav">
            <NavLinks route={route} className="nav-item" folded={folded} />
          </nav>
          <div className="sidebar-footer">
            <button type="button" className="sidebar-toggle" onClick={toggleFold} aria-expanded={!folded} aria-controls="rail-nav" title={folded ? 'Expand the sidebar' : 'Collapse the sidebar'}>
              {folded ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              <span className="sr-only">{folded ? 'Expand the sidebar' : 'Collapse the sidebar'}</span>
            </button>
            <p className="sidebar-note">Vault Enterprise 2.2, vault_ultimate</p>
          </div>
        </aside>

        <div className="vg-main">
          <div className="topbar-wrap">
            <header className="vg-topbar">
              <div className="topbar-left">
                <h1 className="page-title">{page.title}</h1>
              </div>
              <div className="topbar-right">
                <ClusterPill status={status} signedIn={signedIn} />
                <Person me={auth} onSignOut={signOut} />
                <button type="button" className="vault-link said-button" onClick={() => setDrawer(true)}>
                  <ScrollText aria-hidden="true" />
                  <span className="link-label">Vault said</span>
                  <span className="said-count">
                    {log.length}
                    <span className="sr-only"> answers</span>
                  </span>
                </button>
                <button type="button" className="vault-link said-button" onClick={onHelp} aria-label="Keyboard shortcuts">
                  <Keyboard aria-hidden="true" />
                </button>
                <a className="vault-link" href="https://localhost:19701/ui/" target="_blank" rel="noreferrer">
                  <ExternalLink aria-hidden="true" />
                  <span className="link-label">Vault UI</span>
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </div>
            </header>
            <nav className="mobile-nav" aria-label="Pages">
              <NavLinks route={route} className="mobile-nav__item" />
            </nav>
          </div>

          <main id="main" className="vg-content" tabIndex={-1}>
            <page.Page key={page.id} />
          </main>
          <Footer />
        </div>

        <Drawer open={drawer} title="Vault said" onClose={() => setDrawer(false)}>
          <p className="drawer-intro">Every action this page took, newest first, with the Vault calls behind it: who made each call, Vault's status and its errors verbatim. Never a token, password or secret value.</p>
          {log.length === 0 ? (
            <p className="dim">Nothing yet. Start with act 1 on the Scoreboard.</p>
          ) : (
            <ol className="said-list">
              {log.map((e) => (
                <SaidEntry key={e.id} e={e} />
              ))}
            </ol>
          )}
        </Drawer>

        <Drawer open={help} title="Keyboard" onClose={() => setHelp(false)}>
          <dl className="facts">
            <dt>
              <kbd>→</kbd>
            </dt>
            <dd>next page</dd>
            <dt>
              <kbd>←</kbd>
            </dt>
            <dd>previous page</dd>
            <dt>
              <kbd>?</kbd>
            </dt>
            <dd>this list</dd>
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>close a drawer</dd>
          </dl>
        </Drawer>
      </div>
    </AuthContext.Provider>
  );
}
