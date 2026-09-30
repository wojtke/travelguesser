import { lazy, useEffect, useState } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  MapPin,
  Compass,
  Camera,
  Users,
  Copy,
  Plus,
  Link,
  Trash2,
} from 'lucide-react';
import { api, json, copyLink } from './api';
import DailyCard from './DailyCard';
const PublishTrip = lazy(() => import('./Community').then((m) => ({ default: m.PublishTrip })));
import Modal from './Modal';
import GameSettings, { defaultSettings } from './GameSettings';
export default function Home({ host, create, navigate, notify, community = false }) {
  const [publishing, setPublishing] = useState(null),
    [profile, setProfile] = useState(null);
  const [join, setJoin] = useState(''),
    [games, setGames] = useState([]),
    [loadError, setLoadError] = useState('');
  const [deleting, setDeleting] = useState(null),
    [hosting, setHosting] = useState(null),
    [lobbySettings, setLobbySettings] = useState({
      ...defaultSettings,
      mode: 'live',
      timerMode: 'fixed',
      timeLimitSeconds: 60,
    }),
    [hostBusy, setHostBusy] = useState(false);
  async function toggleSharing(game) {
    try {
      await api(`/games/${game.id}/sharing`, json('PATCH', { enabled: !game.sharing }));
      load();
      notify(
        game.sharing ? 'Link sharing paused. Active live sessions ended.' : 'Link sharing enabled.',
      );
    } catch (e) {
      notify(e.message);
    }
  }
  function hostLive(game) {
    if (game.liveId) return navigate(`/g/${game.id}/live/${game.liveId}`);
    setLobbySettings({
      ...defaultSettings,
      ...game.settings,
      mode: 'live',
      timerMode: game.settings?.timerMode === 'afterFirstLock' ? 'afterFirstLock' : 'fixed',
      timeLimitSeconds: game.settings?.timeLimitSeconds || 60,
    });
    setHosting(game);
  }
  const load = () =>
    api('/host/games')
      .then(setGames)
      .catch((e) => setLoadError(e.message));
  useEffect(() => {
    if (host) load();
  }, [host]);
  useEffect(() => {
    if (host && community)
      api('/public-profile')
        .then(setProfile)
        .catch((e) => notify(e.message));
  }, [host, community]);
  function joinGame(e) {
    e.preventDefault();
    const raw = join.trim();
    const publicMatch = raw.match(/\/p\/[\w-]+(?:\/live\/[\w-]+)?/);
    const liveMatch = raw.match(/\/g\/[\w-]+\/live\/[\w-]+/);
    if (publicMatch || liveMatch) return navigate((publicMatch || liveMatch)[0]);
    const id = raw.includes('/g/') ? raw.split('/g/')[1].split(/[?#/]/)[0] : raw;
    if (!/^[a-zA-Z0-9_-]{8,40}$/.test(id))
      return notify('Paste the trip link or code your friend sent you.');
    navigate(`/g/${id}`);
  }
  return (
    <main className="home">
      <section className="hero">
        <div className="hero-copy">
          <h1>
            You were there.
            <br />
            Can they <em>guess where?</em>
          </h1>
          <p className="hero-description">
            Upload photos from your trips, share a link, and let friends guess each location.
          </p>
          <div className="hero-buttons">
            <button className="button primary-large" onClick={create}>
              Create a trip <ArrowUpRight size={21} />
            </button>
            <button
              className="button outline primary-large"
              onClick={() => navigate('/g/demo-trip')}
            >
              <Compass size={19} /> Try a demo
            </button>
          </div>
          <div className="hero-note">
            <span>Friends can play without an account.</span>
          </div>
        </div>
        <div className="hero-art">
          <div className="back-postcard" />
          <div className="postcard">
            <div className="postcard-image">
              <img src="/images/mountains.jpg" alt="Mountain peaks in evening light" />
              <span className="photo-pin">
                <MapPin size={25} />
              </span>
            </div>
          </div>
        </div>
      </section>
      {community && <DailyCard navigate={navigate} />}
      <section id="how-it-works" className="how-section">
        <div className="section-intro">
          <h2>How it works</h2>
        </div>
        <div className="steps">
          <Step
            number="01"
            icon={Camera}
            title="Upload photos"
            text="GPS metadata sets the location automatically. You can also search for a place or choose a point on the map."
          />
          <Step
            number="02"
            icon={Link}
            title="Share the link"
            text="Send your trip link to friends. They enter a name and start playing without an account."
          />
          <Step
            number="03"
            icon={MapPin}
            title="Guess the location"
            text="Place a pin on the map for each photo. Closer guesses earn more points."
          />
        </div>
      </section>
      {host && (
        <section className="my-trips" id="my-trips">
          <div className="section-heading">
            <div>
              <h2>My trips</h2>
            </div>
            <button className="text-button" onClick={create}>
              New trip <Plus size={16} />
            </button>
          </div>
          {profile?.notice && (
            <p className="error" role="alert">
              {profile.notice} <a href="/contact">Request review</a>
            </p>
          )}
          {profile?.activeRoom && (
            <p>
              <button
                className="text-button"
                onClick={() =>
                  navigate(`/p/${profile.activeRoom.publicationId}/live/${profile.activeRoom.id}`)
                }
              >
                Open your most recent friend room
              </button>
            </p>
          )}
          {profile?.scores?.length > 0 && (
            <details className="panel">
              <summary>My public scores</summary>
              {profile.scores.map((r) => (
                <p key={r.id}>
                  {r.title}{' '}
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        await api(`/publications/${r.id}/leaderboard/me`, { method: 'DELETE' });
                        setProfile((p) => ({
                          ...p,
                          scores: p.scores.filter((s) => s.id !== r.id),
                        }));
                        notify('Your public score was removed.');
                      } catch (e) {
                        notify(e.message);
                      }
                    }}
                  >
                    Remove my score
                  </button>
                </p>
              ))}
              {profile.cursor && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      const more = await api(
                        `/public-profile?cursor=${encodeURIComponent(profile.cursor)}`,
                      );
                      setProfile((p) => ({ ...more, scores: [...p.scores, ...more.scores] }));
                    } catch (e) {
                      notify(e.message);
                    }
                  }}
                >
                  Load more scores
                </button>
              )}
            </details>
          )}
          {loadError && (
            <p className="error" role="alert">
              {loadError}
            </p>
          )}
          {games.length ? (
            <div className="trip-grid">
              {games.map((game) => (
                <article className="trip-card" key={game.id}>
                  <div className="trip-card-icon">
                    <MapPin size={26} />
                  </div>
                  <div>
                    <span className="eyebrow">
                      {game.rounds} PHOTO{game.rounds === 1 ? '' : 'S'} ·{' '}
                      {new Date(game.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <h3>{game.title}</h3>
                    <p>
                      {game.sharing ? 'Link-only' : 'Sharing paused'} ·{' '}
                      {game.liveId ? 'Live lobby open' : 'Play at your own pace'}
                    </p>
                  </div>
                  <div className="trip-card-actions">
                    {community && (
                      <button className="button outline small" onClick={() => setPublishing(game)}>
                        Public sharing
                      </button>
                    )}
                    <button
                      className="button outline small"
                      disabled={!game.sharing}
                      onClick={() => hostLive(game)}
                    >
                      <Users size={15} />
                      {game.liveId ? 'Open lobby' : 'Host live'}
                    </button>
                    <button
                      className="text-button sharing-toggle"
                      onClick={() => toggleSharing(game)}
                    >
                      {game.sharing ? 'Pause sharing' : 'Enable sharing'}
                    </button>
                    <button
                      className="button outline small"
                      onClick={() => copyLink(game.id, notify)}
                    >
                      <Copy size={15} /> Invite
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Open ${game.title}`}
                      onClick={() => navigate(`/g/${game.id}`)}
                    >
                      <ArrowUpRight size={20} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete ${game.title}`}
                      onClick={() => setDeleting(game)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-trips">
              <Camera size={25} />
              <p>You haven’t created any trips yet.</p>
              <button className="text-button" onClick={create}>
                Create your first trip <ArrowRight size={16} />
              </button>
            </div>
          )}
        </section>
      )}
      <section className="invite-strip">
        <div className="invite-icon">
          <Users size={24} />
        </div>
        <div>
          <h3>Join a trip</h3>
          <p>Enter a trip link or code.</p>
        </div>
        <form onSubmit={joinGame}>
          <label className="sr-only" htmlFor="trip-link">
            Trip link or code
          </label>
          <input
            id="trip-link"
            value={join}
            onChange={(e) => setJoin(e.target.value)}
            placeholder="Paste a trip link or code"
            required
          />
          <button className="button" type="submit">
            Join trip <ArrowRight size={17} />
          </button>
        </form>
      </section>
      {hosting && (
        <Modal close={() => setHosting(null)} title="Host a live game">
          <p>
            {hosting.title} · {hosting.rounds} photos. Friends join the lobby before you start.
          </p>
          <GameSettings value={lobbySettings} onChange={setLobbySettings} showMode={false} />
          <button
            className="button full"
            disabled={hostBusy}
            onClick={async () => {
              setHostBusy(true);
              try {
                const lobby = await api(`/games/${hosting.id}/live`, json('POST', lobbySettings));
                navigate(`/g/${hosting.id}/live/${lobby.id}`);
              } catch (e) {
                notify(e.message);
              } finally {
                setHostBusy(false);
              }
            }}
          >
            Open lobby <ArrowRight size={18} />
          </button>
        </Modal>
      )}
      {deleting && (
        <Modal close={() => setDeleting(null)} title="Delete this trip?">
          <p>
            “{deleting.title}” and its photos and scores will be deleted. Its invite link will stop
            working.
          </p>
          <div className="modal-actions">
            <button className="button outline" onClick={() => setDeleting(null)}>
              Keep trip
            </button>
            <button
              className="button danger"
              onClick={async () => {
                try {
                  await api(`/games/${deleting.id}`, { method: 'DELETE' });
                  setDeleting(null);
                  load();
                  notify('Trip deleted.');
                } catch (e) {
                  notify(e.message);
                }
              }}
            >
              Delete trip
            </button>
          </div>
        </Modal>
      )}
      {publishing && (
        <PublishTrip
          game={publishing}
          close={() => setPublishing(null)}
          notify={notify}
          navigate={navigate}
        />
      )}
    </main>
  );
}

function Step({ number, icon: Icon, title, text }) {
  return (
    <article className="step">
      <div className="step-top">
        <span className="step-icon">
          <Icon size={23} strokeWidth={1.6} />
        </span>
        <span className="step-number">{number}</span>
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
