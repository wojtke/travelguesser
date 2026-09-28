import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  LoaderCircle,
  MapPin,
  Users,
  Trophy,
  X,
} from 'lucide-react';
import { api, json, formatDistance } from './api';
import Map, { playerColors } from './Map';
import PhotoViewer from './PhotoViewer';
import MapPanel from './MapPanel';
import RoundClock from './RoundClock';

export default function LiveGame({ id, liveId, navigate, notify }) {
  const [live, setLive] = useState(null),
    [error, setError] = useState(''),
    [fatal, setFatal] = useState(false),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(''),
    [pin, setPin] = useState(null);
  const working = useRef(false),
    mounted = useRef(true),
    polling = useRef(false),
    stopped = useRef(false),
    base = `/games/${id}/live/${liveId}`;
  const accept = useCallback((data) => {
    if (mounted.current) {
      setLive((old) =>
        !old || data.revision > old.revision || data.isHost !== old.isHost ? data : old,
      );
      setError('');
      if (data.phase === 'finished' || (data.me && !data.me.active && !data.isHost))
        stopped.current = true;
    }
  }, []);
  const refresh = useCallback(
    async (signal) => {
      if (polling.current || stopped.current) return;
      polling.current = true;
      try {
        accept(await api(base, { signal }));
      } catch (e) {
        if (e.name === 'AbortError' || !mounted.current) return;
        setError(e.message);
        if ([403, 404, 410].includes(e.status)) {
          setFatal(true);
          stopped.current = true;
        }
      } finally {
        polling.current = false;
      }
    },
    [base, accept],
  );
  useEffect(() => {
    mounted.current = true;
    stopped.current = false;
    let timer,
      closed = false;
    const controller = new AbortController();
    async function poll() {
      if (!document.hidden) await refresh(controller.signal);
      if (!closed && !stopped.current) timer = setTimeout(poll, 3000);
    }
    poll();
    // A focus refresh is useful after returning from a chat app with the invite link.
    const focus = () => {
      if (!closed && !document.hidden) refresh(controller.signal);
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      closed = true;
      mounted.current = false;
      clearTimeout(timer);
      controller.abort();
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [refresh]);
  useEffect(() => {
    setPin(null);
  }, [live?.round]);
  async function action(type, body = {}) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await api(`${base}/${type}`, json('POST', { round: live?.round, ...body }));
      accept(data);
    } catch (e) {
      setError(e.message);
      if ([403, 404, 410].includes(e.status)) refresh();
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const canGuess = live?.phase === 'round' && live.me?.active && !live.me.guess;
  useEffect(() => {
    if (!canGuess || !pin || busy) return;
    const key = (e) => {
      if (
        (e.code !== 'Space' && e.key !== ' ') ||
        e.repeat ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.defaultPrevented
      )
        return;
      if (
        e.target instanceof Element &&
        e.target.closest(
          'input,textarea,select,button,a,summary,[contenteditable="true"],[role="button"],[role="dialog"]',
        )
      )
        return;
      e.preventDefault();
      action('guess', pin);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [canGuess, pin, busy, live?.round]);
  const invite = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      notify('Lobby link copied.');
    } catch {
      notify('Copy the lobby link from the address bar.');
    }
  };
  if (fatal)
    return (
      <main className="narrow-page">
        <h1>Lobby unavailable</h1>
        <p role="alert">{error}</p>
        <button className="button" onClick={() => navigate('/')}>
          Back to my trips
        </button>
      </main>
    );
  if (!live)
    return (
      <main className="narrow-page">
        {error ? (
          <>
            <p className="error" role="alert">
              {error}
            </p>
            <button className="button" onClick={() => refresh()}>
              Try again
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" /> Loading lobby…
          </>
        )}
      </main>
    );
  if (live.me && !live.me.active && !live.isHost)
    return (
      <main className="narrow-page">
        <h1>You are no longer in this lobby</h1>
        <p>Your access to this session has ended.</p>
        <button className="button" onClick={() => navigate('/')}>
          Back home
        </button>
      </main>
    );
  const joinForm = (
    <form
      className="live-join"
      onSubmit={(e) => {
        e.preventDefault();
        action('join', { name });
      }}
    >
      <label htmlFor="live-nickname">Your nickname</label>
      <div>
        <input
          id="live-nickname"
          required
          maxLength={24}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="nickname"
          placeholder="Name shown to the group"
        />
        <button className="button" disabled={busy}>
          <Users size={18} /> Join lobby
        </button>
      </div>
    </form>
  );
  if (!live.joined && !live.isHost)
    return (
      <main className="narrow-page live-intro">
        <span className="pill">
          <Users size={16} /> Live game · {live.playerCount} joined
        </span>
        <h1>{live.title}</h1>
        <p>
          Hosted by {live.hostName}. {live.rounds} photos ·{' '}
          {live.settings.timeLimitSeconds
            ? `${live.settings.timeLimitSeconds} seconds per photo`
            : 'No time limit'}
          .
        </p>
        {live.phase === 'lobby' ? (
          <>
            <p>
              The host starts each round. Guesses stay hidden until everyone submits or time runs
              out.
            </p>
            {joinForm}
          </>
        ) : (
          <p>This game has already started. Ask the host for the next lobby link.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="small-note">
          No account needed. Your nickname and results are visible to this group.{' '}
          <a href="/privacy">Privacy notice</a>
        </p>
      </main>
    );
  const active = live.players.filter((p) => p.active),
    submitted = active.filter((p) => p.submitted).length;
  const errors = error && (
    <p className="error live-error" role="alert">
      {error} · Reconnecting automatically.
    </p>
  );
  if (live.phase === 'lobby')
    return (
      <main className="live-page">
        <button className="back-link" onClick={() => navigate('/')}>
          <ArrowLeft size={16} /> My trips
        </button>
        <div className="live-title">
          <div>
            <span className="pill">
              <Users size={16} /> Live lobby
            </span>
            <h1>{live.title}</h1>
            <p>
              {live.rounds} photos ·{' '}
              {live.settings.timeLimitSeconds
                ? `${live.settings.timeLimitSeconds}s per photo`
                : 'No time limit'}{' '}
              · {live.settings.shufflePhotos ? 'Shuffled order' : 'Upload order'}
            </p>
          </div>
          <button className="button outline" onClick={invite}>
            <Copy size={17} /> Invite friends
          </button>
        </div>
        <div className="live-lobby-grid">
          <section className="panel live-card">
            <h2>
              Players{' '}
              <span>
                {live.playerCount} / {live.limits.players}
              </span>
            </h2>
            {live.players.length ? (
              <ul className="lobby-players">
                {live.players.map((p) => (
                  <li key={p.id}>
                    <span>
                      {p.name}
                      {p.id === live.me?.id ? ' (you)' : ''}
                    </span>
                    {live.isHost && p.id !== live.me?.id && (
                      <button
                        className="icon-button"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => action('remove', { playerId: p.id })}
                        disabled={busy}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Share the link so friends can join.</p>
            )}
            {live.joined ? (
              <p className="small-note">
                <Check size={15} /> You’re in.{' '}
                {live.isHost ? 'Start when everyone is ready.' : 'Waiting for the host to start.'}
              </p>
            ) : (
              joinForm
            )}
          </section>
          <section className="panel live-card">
            <h2>{live.isHost ? 'Host controls' : 'How it works'}</h2>
            <p>
              Everyone gets the same photo. Results show everyone’s pin and distance after all
              guesses are in{live.settings.timeLimitSeconds ? ' or the timer expires' : ''}. The
              host starts the next round.
            </p>
            {live.isHost && (
              <>
                <p className="small-note">
                  You can host without playing, or join above. As the creator, you already know the
                  locations.
                </p>
                <button
                  className="button full"
                  disabled={busy || !active.length}
                  onClick={() => action('start')}
                >
                  Start first round <ArrowRight size={18} />
                </button>
              </>
            )}
            <p className="small-note">
              Lobby links expire after 24 hours. Only people with the link can enter; links can be
              forwarded.
            </p>
          </section>
        </div>
        {errors}
      </main>
    );
  if (live.phase === 'round')
    return (
      <main key={`play-${live.round}`} className="play-page live-play">
        <PhotoViewer
          key={`photo-${live.round}`}
          src={live.photoUrl}
          alt={`Mystery photo for round ${live.round + 1}`}
        />
        <header className="play-heading">
          <button className="play-home" aria-label="Back home" onClick={() => navigate('/')}>
            <ArrowLeft size={19} />
          </button>
          <div className="play-trip">
            <span className="eyebrow">{live.title} · LIVE</span>
            <h1>
              Round {live.round + 1} / {live.rounds}
            </h1>
          </div>
          <div className="play-stats">
            <span>
              <Users size={16} />
              {submitted} / {active.length} guessed
            </span>
            <RoundClock
              deadline={live.deadline}
              serverNow={live.serverNow}
              onExpire={() => refresh()}
            />
          </div>
        </header>
        {(live.me?.guess || !live.me?.active) && (
          <div className="live-waiting" role="status">
            {live.me?.guess
              ? 'Guess confirmed. Waiting for the group.'
              : live.isHost
                ? 'You are watching as host.'
                : 'You are watching this round.'}
          </div>
        )}
        <MapPanel
          key={`map-${live.round}`}
          pin={!!(pin || live.me?.guess)}
          title={canGuess ? 'Choose a location' : 'Waiting for results'}
        >
          <Map
            value={live.me?.guess || pin}
            onChange={canGuess ? setPin : undefined}
            className="guess-map"
          />
          <div className="guess-controls">
            {canGuess ? (
              <button
                className="button full"
                disabled={!pin || busy}
                onClick={() => action('guess', pin)}
                aria-keyshortcuts="Space"
              >
                <MapPin size={17} />
                {pin ? 'Confirm guess' : 'Drop a pin to guess'}
                {pin && <kbd>SPACE</kbd>}
              </button>
            ) : (
              <p className="small-note">
                {submitted} of {active.length} active players have guessed.
              </p>
            )}
            {live.isHost && (
              <details className="live-host-options">
                <summary>Host controls</summary>
                <button className="text-button" disabled={busy} onClick={() => action('reveal')}>
                  Reveal now · missing guesses get 0
                </button>
                <ul className="lobby-players">
                  {active
                    .filter((p) => !p.submitted && p.id !== live.me?.id)
                    .map((p) => (
                      <li key={p.id}>
                        {p.name}
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => action('remove', { playerId: p.id })}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                </ul>
              </details>
            )}
            {errors}
          </div>
        </MapPanel>
      </main>
    );
  const finished = live.phase === 'finished',
    totals = [...live.players].sort((a, b) => b.score - a.score),
    actual = live.results[0]?.actual;
  return (
    <main key={`results-${live.round}`} className="live-page live-results">
      <div className="live-title">
        <div>
          <span className="pill">
            <Trophy size={16} /> {finished ? 'Final scores' : `Round ${live.round + 1} results`}
          </span>
          <h1>{live.title}</h1>
          {live.results[0]?.caption && <p>{live.results[0].caption}</p>}
        </div>
        {live.photoUrl && (
          <a className="result-photo-link" href={live.photoUrl} target="_blank" rel="noreferrer">
            <img src={live.photoUrl} alt="Photo from this round" />
            <span>View photo</span>
          </a>
        )}
      </div>
      <div className="live-results-grid">
        {actual && !finished && (
          <section className="panel live-result-map">
            <Map actual={actual} guesses={live.results} className="multiplayer-map" />
            <p className="small-note">
              <i className="actual-dot" /> Actual location · numbered pins match the table
            </p>
          </section>
        )}
        <section className="panel live-card">
          <h2>{finished ? 'Leaderboard' : 'Everyone’s guesses'}</h2>
          <div className="live-score-scroll">
            <table className="live-score-table">
              <thead>
                <tr>
                  <th>Player</th>
                  {!finished && <th>Distance</th>}
                  <th>{finished ? 'Total' : 'Round'}</th>
                  {!finished && <th>Total</th>}
                </tr>
              </thead>
              <tbody>
                {(finished ? totals : live.results).map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      <span
                        className="player-color"
                        style={{ background: playerColors[i % playerColors.length] }}
                      >
                        {i + 1}
                      </span>
                      {p.name}
                      {p.id === live.me?.id ? ' (you)' : ''}
                    </td>
                    {!finished && <td>{formatDistance(p.distance)}</td>}
                    <td>{p.score.toLocaleString()}</td>
                    {!finished && <td>{p.total.toLocaleString()}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!finished && (
            <p className="small-note">No guess = 0 points. Guesses are final once confirmed.</p>
          )}
        </section>
      </div>
      <div className="live-next">
        {finished ? (
          <button className="button" onClick={() => navigate('/')}>
            Back to my trips
          </button>
        ) : live.isHost ? (
          <button className="button" disabled={busy} onClick={() => action('next')}>
            {live.round + 1 === live.rounds ? 'Show final scores' : 'Start next round'}{' '}
            <ArrowRight size={18} />
          </button>
        ) : (
          <p role="status">
            Waiting for the host to{' '}
            {live.round + 1 === live.rounds ? 'show final scores' : 'start the next round'}.
          </p>
        )}
        {!finished && live.isHost && (
          <button className="text-button" disabled={busy} onClick={() => action('end')}>
            End session here
          </button>
        )}
      </div>
      {errors}
    </main>
  );
}
