import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api, json } from './api';
import Modal from './Modal';
export default function CreatorLogin({ config, close, success }) {
  const [signIn, setSignIn] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (config?.provider === 'local')
      setSignIn(() => () => api('/auth/session', json('POST', { idToken: 'local-development' })));
    else if (config?.firebase)
      import('./google-auth')
        .then((m) => m.prepareGoogleSignIn(config.firebase))
        .then((fn) => {
          if (active) setSignIn(() => fn);
        })
        .catch(() => {
          if (active) setError('Couldn’t prepare Google sign-in. Please refresh and try again.');
        });
    else setError('Sign-in is unavailable. Please refresh and try again.');
    return () => {
      active = false;
    };
  }, [config]);
  return (
    <Modal close={close} title="Sign in">
      <p>
        Sign in with Google to create and manage your trips. Friends only need a trip link to play.
      </p>
      <button
        type="button"
        className="button full google-signin"
        disabled={!signIn || busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            success(await signIn());
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <LoaderCircle size={19} className="spin" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M43.6 24.5c0-1.5-.1-3-.4-4.5H24v8.5h11a9.4 9.4 0 0 1-4.1 6.2v5.2h6.7c3.9-3.6 6-8.8 6-15.4z"
            />
            <path
              fill="#34A853"
              d="M24 44c5.4 0 10-1.8 13.3-4.9l-6.7-5.2c-1.8 1.2-4 2-6.6 2-5.2 0-9.6-3.5-11.2-8.2H5.9v5.3A20 20 0 0 0 24 44z"
            />
            <path fill="#FBBC05" d="M12.8 27.7a12 12 0 0 1 0-7.4V15H5.9a20 20 0 0 0 0 18z" />
            <path
              fill="#EA4335"
              d="M24 12.1c2.9 0 5.5 1 7.5 2.9l5.6-5.6A19 19 0 0 0 24 4 20 20 0 0 0 5.9 15l6.9 5.3C14.4 15.6 18.8 12.1 24 12.1z"
            />
          </svg>
        )}
        {busy
          ? 'Signing in…'
          : config?.provider === 'local'
            ? 'Continue locally'
            : 'Continue with Google'}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="small-note">
        By continuing, you agree to the{' '}
        <a href="/terms" target="_blank" rel="noreferrer">
          Terms
        </a>
        . Read our{' '}
        <a href="/privacy" target="_blank" rel="noreferrer">
          Privacy notice
        </a>
        .
      </p>
      <p className="small-note">
        Up to 5 trips · 12 photos per trip
        <br />
        We only use your basic Google profile. Your public host name is up to you.
      </p>
    </Modal>
  );
}
