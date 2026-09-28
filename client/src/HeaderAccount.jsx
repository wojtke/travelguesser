import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, ChevronDown, LogIn, LogOut } from 'lucide-react';

export default function HeaderAccount({ user, ready, signIn, signOut }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const ref = useRef(null),
    trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  if (!ready)
    return (
      <div className="header-account">
        <button className="account-trigger" disabled aria-label="Checking sign-in status">
          <LoaderCircle size={18} className="spin" />
          <span>Loading…</span>
        </button>
      </div>
    );
  if (!user)
    return (
      <div className="header-account">
        <button className="button outline small header-signin" onClick={signIn}>
          <LogIn size={16} /> Sign in
        </button>
      </div>
    );
  const name = user.name || 'Account';
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => Array.from(part)[0])
    .slice(0, 2)
    .join('')
    .toLocaleUpperCase();
  return (
    <div
      className="header-account"
      ref={ref}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="account-trigger"
        aria-label={`Signed in as ${name}. Account options`}
        aria-expanded={open}
        aria-controls="account-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="account-label">
          <small>Signed in</small>
          <strong>{name}</strong>
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div id="account-panel" className="account-panel" role="group" aria-label="Your account">
          <span className="eyebrow">YOUR ACCOUNT</span>
          <strong>{name}</strong>
          <button
            className="text-button account-signout"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await signOut();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <LogOut size={16} />}{' '}
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
