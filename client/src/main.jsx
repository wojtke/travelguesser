import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, MapPin, Compass, Plus, X, LockKeyhole, LoaderCircle } from 'lucide-react';
import { api } from './api';
import Home from './Home';
import HeaderAccount from './HeaderAccount';
import CreatorLogin from './CreatorLogin';
const SharedResults = lazy(() => import('./ResultsPanels'));
const Game = lazy(() => import('./Game'));
const LiveGame = lazy(() => import('./LiveGame'));
const CreateTrip = lazy(() => import('./CreateTrip'));
const Legal = lazy(() => import('./Legal'));
const Explore = lazy(() => import('./Community').then((m) => ({ default: m.Explore })));
const PublicTrip = lazy(() => import('./Community').then((m) => ({ default: m.PublicTrip })));
const Contact = lazy(() => import('./Contact'));
const CommunityAdmin = lazy(() => import('./CommunityAdmin'));
import './community.css';
import './styles.css';
import './game.css';
import './live.css';
function App() {
  const [route, setRoute] = useState(location.pathname + location.search);
  const path = route.split('?')[0];
  const [community, setCommunity] = useState({ enabled: false, admin: false });
  const [user, setUser] = useState(null),
    [authConfig, setAuthConfig] = useState(null),
    [ready, setReady] = useState(false);
  const host = !!user;
  const [login, setLogin] = useState(null),
    [toast, setToast] = useState('');
  const notify = (message) => setToast(message);
  const navigate = (path) => {
    if (
      !window.dispatchEvent(
        new CustomEvent('tripguessr:navigate', { cancelable: true, detail: path }),
      )
    )
      return;
    history.pushState({}, '', path);
    const target = new URL(path, location.origin);
    setRoute(target.pathname + target.search);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    // Remove optional name-prefill storage used by earlier versions. Only essential session cookies remain.
    try {
      localStorage.removeItem('tg_player_name');
      localStorage.removeItem('tg_host_name');
    } catch {}
    const listener = () => setRoute(location.pathname + location.search);
    addEventListener('popstate', listener);
    if (new URLSearchParams(location.hash.slice(1)).has('host'))
      history.replaceState({}, '', location.pathname);
    api('/session')
      .then((data) => {
        setUser(data.user);
        setAuthConfig(data.auth);
      })
      .catch((e) => notify(e.message))
      .finally(() => setReady(true));
    return () => removeEventListener('popstate', listener);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (ready)
      api('/community/config')
        .then(setCommunity)
        .catch(() => {});
  }, [ready, user?.uid]);
  const create = () => (host ? navigate('/create') : setLogin('/create'));
  const signOut = async () => {
    try {
      await api('/auth/session', { method: 'DELETE' });
      setUser(null);
      navigate('/');
    } catch (e) {
      notify(e.message);
    }
  };
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            <span className="brand-icon">
              <MapPin size={22} strokeWidth={2} />
            </span>
            tripguessr<span className="brand-dot">.</span>
          </a>
          <nav aria-label="Main navigation">
            {(community.enabled || community.admin) && (
              <button className="text-button" onClick={() => navigate('/explore')}>
                Explore
              </button>
            )}
            {community.admin && (
              <button className="text-button" onClick={() => navigate('/admin')}>
                Admin
              </button>
            )}
            <a
              className="how-link"
              href="/#how-it-works"
              onClick={(e) => {
                if (path !== '/') {
                  e.preventDefault();
                  navigate('/');
                  setTimeout(
                    () =>
                      document
                        .getElementById('how-it-works')
                        ?.scrollIntoView({ behavior: 'smooth' }),
                    100,
                  );
                }
              }}
            >
              How it works
            </a>
            {host && (
              <button
                className="text-button trips-nav"
                onClick={() => {
                  navigate('/');
                  setTimeout(
                    () =>
                      document.getElementById('my-trips')?.scrollIntoView({ behavior: 'smooth' }),
                    100,
                  );
                }}
              >
                My trips
              </button>
            )}
            <button className="button small" onClick={create}>
              <Plus size={16} /> Create a trip
            </button>
          </nav>
          <HeaderAccount
            key={user?.uid || 'guest'}
            user={user}
            ready={ready}
            signIn={() => setLogin(route)}
            signOut={signOut}
          />
        </div>
      </header>
      <Suspense
        fallback={
          <div className="loading-page">
            <LoaderCircle className="spin" /> Loading…
          </div>
        }
      >
        {!ready ? (
          <div className="loading-page">
            <LoaderCircle className="spin" /> Loading…
          </div>
        ) : path === '/create' || /^\/g\/[^/]+\/edit\/?$/.test(path) ? (
          host ? (
            <CreateTrip
              key={path}
              id={path === '/create' ? null : path.split('/')[2]}
              user={user}
              navigate={navigate}
              notify={notify}
              signIn={() => setLogin(path)}
            />
          ) : (
            <div className="narrow-page">
              <LockKeyhole size={38} />
              <h1>{path === '/create' ? 'Create a trip' : 'Edit your trip'}</h1>
              <p>
                Sign in with Google to create and manage trips. Friends can play without signing in.
              </p>
              <button className="button" onClick={() => setLogin(path)}>
                Continue with Google <ArrowRight size={18} />
              </button>
            </div>
          )
        ) : /^\/g\/[^/]+\/results\/[^/]+\/?$/.test(path) ? (
          <SharedResults
            key={route}
            id={path.split('/')[2]}
            token={path.split('/')[4]}
            navigate={navigate}
          />
        ) : /^\/g\/[^/]+\/live\/[^/]+\/?$/.test(path) ? (
          <LiveGame
            key={route}
            id={path.split('/')[2]}
            liveId={path.split('/')[4]}
            navigate={navigate}
            notify={notify}
          />
        ) : path === '/explore' ? (
          <Explore key={route} navigate={navigate} />
        ) : path === '/admin' ? (
          <CommunityAdmin navigate={navigate} />
        ) : path === '/contact' || /^\/contact\/[^/]+$/.test(path) ? (
          <Contact key={route} id={path.split('/')[2]} navigate={navigate} />
        ) : /^\/p\/[^/]+\/results\/[^/]+$/.test(path) ? (
          <SharedResults
            key={route}
            id={path.split('/')[2]}
            token={path.split('/')[4]}
            navigate={navigate}
            publicTrip
          />
        ) : /^\/p\/[^/]+\/live\/[^/]+$/.test(path) ? (
          <LiveGame
            key={route}
            id={path.split('/')[2]}
            liveId={path.split('/')[4]}
            navigate={navigate}
            notify={notify}
            publicTrip
          />
        ) : /^\/p\/[^/]+\/play$/.test(path) ? (
          <Game
            key={route}
            id={path.split('/')[2]}
            navigate={navigate}
            notify={notify}
            publicTrip
            user={user}
            signIn={() => setLogin(route)}
          />
        ) : /^\/p\/[^/]+$/.test(path) ? (
          <PublicTrip
            key={route}
            id={path.split('/')[2]}
            navigate={navigate}
            notify={notify}
            user={user}
            signIn={() => setLogin(route)}
          />
        ) : ['/privacy', '/terms', '/cookies'].includes(path) ? (
          <Legal page={path.slice(1)} />
        ) : /^\/g\/[^/]+\/?$/.test(path) ? (
          <Game key={route} id={path.split('/')[2]} navigate={navigate} notify={notify} />
        ) : path === '/' ? (
          <Home
            key={user?.uid || 'guest'}
            host={host}
            community={community.enabled || community.admin}
            create={create}
            navigate={navigate}
            notify={notify}
          />
        ) : (
          <div className="narrow-page">
            <h1>Page not found</h1>
            <p>We couldn’t find that page.</p>
            <button className="button" onClick={() => navigate('/')}>
              Back home
            </button>
          </div>
        )}
      </Suspense>
      <footer className="site-footer">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          <Compass size={16} /> TripGuessr
        </a>
        <nav aria-label="Legal information">
          {[
            ['/privacy', 'Privacy'],
            ['/terms', 'Terms'],
            ['/cookies', 'Cookies'],
            ['/contact', 'Contact / report'],
          ].map(([url, label]) => (
            <a
              key={url}
              href={url}
              onClick={(e) => {
                e.preventDefault();
                navigate(url);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </footer>
      {login && (
        <CreatorLogin
          config={authConfig}
          close={() => setLogin(null)}
          success={(data) => {
            setUser(data.user);
            setLogin(null);
            if (login !== route) navigate(login);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
