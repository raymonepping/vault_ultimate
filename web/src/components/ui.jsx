// components/ui.jsx: small shared pieces (vault_dance, vault_codex).
import { createContext, useContext, useEffect, useRef } from 'react';
import { X, LogIn } from 'lucide-react';

// The signed-in person (GET /api/session), plus
// refresh() after a sign-in or sign-out.
export const AuthContext = createContext({ signedIn: false, refresh: () => {} });
export const useAuth = () => useContext(AuthContext);

// Vault's errors arrive as "1 error occurred:\n\t* permission denied\n\n".
const tidy = (v) => String(v).replace(/^\d+ errors? occurred:\s*/, '').replace(/^\*\s*/, '').replace(/\s+/g, ' ').trim();


// An error from the API, with Vault's own error lines verbatim.
export { tidy };

export function ErrorNotice({ error, title }) {
  if (!error) return null;
  if (error.status === 401) return <SignInNotice />;
  const vault = (error.body?.vault?.errors || []).map(tidy);
  return (
    <div className="inline-notice error" role="alert">
      <strong>{title || 'Refused'}</strong>
      {error.status ? <span className="vault-status"> HTTP {error.status}</span> : null}
      {vault.length ? (
        <ul className="vault-errors">
          {vault.map((v) => (
            <li key={v}>
              Vault said: <code>{v}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0">{error.message}</p>
      )}
    </div>
  );
}

// Saskia signs in through Keycloak (D14): the console sends her to
// Keycloak's own form; the API keeps her Vault token, the browser only a
// session cookie. A failed sign-in comes back as ?signin=<reason>.
export function SignInNotice() {
  const reason = new URLSearchParams(window.location.search).get('signin');
  return (
    <section className="vg-card signin-notice" aria-labelledby="signin-h">
      <h3 id="signin-h">Sign in as Saskia</h3>
      <p>
        Saskia, the platform engineer, signs in through Keycloak; the console trades that for her own Vault token, so every act, revoke and rotation runs as her and Vault&apos;s audit log names her. Password: <code className="mono">make people-copy-password</code>.
      </p>
      <a className="primary-button" href="/auth/login">
        <LogIn size={14} aria-hidden="true" /> Sign in with Keycloak
      </a>
      {reason && (
        <p className="inline-notice error" role="alert">
          {reason}
        </p>
      )}
    </section>
  );
}

// A table that may scroll sideways on a phone: focusable and named, so a
// keyboard can scroll it (axe scrollable-region-focusable).
export function TableScroll({ label, children }) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}



// Right-hand drawer; Escape and the backdrop close it; focus moves in.
export function Drawer({ open, title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="vg-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="vg-drawer" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="vg-drawer__header">
          <h2 className="vg-drawer__title">{title}</h2>
          <button type="button" className="vg-btn vg-btn--ghost" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="vg-drawer__body">{children}</div>
      </aside>
    </>
  );
}


export function Loading({ label = 'Asking Vault…' }) {
  return (
    <div className="vg-loading" role="status">
      <span className="vg-live-dot" aria-hidden="true" />
      {label}
    </div>
  );
}

