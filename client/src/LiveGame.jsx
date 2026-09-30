import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin, Users, Copy, LoaderCircle } from 'lucide-react';
import PhotoCredit from './PhotoCredit';
import useLiveSession from './useLiveSession';
import { formatDistance } from './api';
import Map, { playerColors } from './Map';
import PhotoViewer from './PhotoViewer';
import MapPanel from './MapPanel';
import CoordinateFields from './CoordinateFields';
import RoundClock, { enableCountdownAudio } from './RoundClock';
import { Standings, ScoreMatrix, ShareActions, RoundCards, duration } from './ResultsPanels';
export default function LiveGame({ id, liveId, navigate, notify, publicTrip = false }) {
  const { live, error, fatal, busy, pin, setPin, saveStatus, retrySave, action, refresh, ready } =
    useLiveSession(id, liveId, publicTrip);
  const [name, setName] = useState(''),
    [now, setNow] = useState(Date.now()),
    [loadedRound, setLoadedRound] = useState(-1),
    [mapFilter, setMapFilter] = useState('all');
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  const preparing = live?.phase === 'preparing' && now + (live.clockOffsetMs || 0) < live.startsAt;
  const canGuess =
    live &&
    ['preparing', 'round'].includes(live.phase) &&
    !preparing &&
    live.me?.active &&
    !live.me.guess;
  useEffect(() => {
    if (!canGuess || !pin || busy) return;
    const key = (e) => {
      if (
        e.code !== 'Space' ||
        e.repeat ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        e.defaultPrevented ||
        e.target.closest?.(
          'input,textarea,select,button,a,summary,[contenteditable],[role="dialog"]',
        )
      )
        return;
      e.preventDefault();
      action('guess', pin);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [canGuess, pin, busy, live?.round]);
  if (fatal)
    return (
      <main className="narrow-page">
        <h1>{fatal}</h1>
        <p>Your access to this session has ended.</p>
        <button className="button" onClick={() => navigate('/')}>
          Back home
        </button>
      </main>
    );
  if (!live)
    return (
      <main className="narrow-page">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={refresh}>Try again</button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" /> Loading lobby…
          </>
        )}
      </main>
    );
  const invite = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      notify('Live lobby invitation copied.');
    } catch {
      notify('Copy the lobby URL from the address bar.');
    }
  };
  const joinForm = (
    <form
      className="live-join"
      onSubmit={(e) => {
        e.preventDefault();
        enableCountdownAudio();
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
        />
        <button className="button" disabled={busy}>
          Join lobby
        </button>
      </div>
      {publicTrip && (
        <p className="small-note">
          Joining uses your first attempt for this trip and changes any ranked attempt in progress
          to practice.
        </p>
      )}
    </form>
  );
  const errors = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );
  const timing =
    live.settings.timerMode === 'afterFirstLock'
      ? `${live.settings.afterFirstLockSeconds}s after the first confirmation`
      : live.settings.timeLimitSeconds
        ? `${live.settings.timeLimitSeconds}s per photo`
        : 'No time limit';
  if (!live.joined && !live.isHost)
    return (
      <main className="narrow-page">
        <h1>{live.title}</h1>
        <p>
          Hosted by {live.hostName} · {live.playerCount} players · {timing}
        </p>
        {live.phase === 'lobby' ? (
          joinForm
        ) : (
          <p>This game has already started. Ask the host for the next lobby link.</p>
        )}
        {errors}
      </main>
    );
  const active = live.players.filter((p) => p.active),
    submitted = active.filter((p) => p.submitted).length;
  if (live.phase === 'lobby')
    return (
      <main className="live-page">
        <button className="back-link" onClick={() => navigate(publicTrip ? `/p/${id}` : '/')}>
          <ArrowLeft size={16} /> {publicTrip ? 'Back to trip' : 'My trips'}
        </button>
        <div className="live-title">
          <div>
            <h1>{live.title}</h1>
            <p>
              {live.rounds} photos · {timing}
            </p>
          </div>
          <button className="button outline" onClick={invite}>
            <Copy size={17} /> Invite to lobby
          </button>
        </div>
        <div className="live-lobby-grid">
          <section className="panel live-card">
            <h2>
              Players {live.playerCount} / {live.limits.players}
            </h2>
            <ul className="lobby-players">
              {live.players.map((p) => (
                <li key={p.id}>
                  {p.name}
                  {p.id === live.me?.id ? ' (You)' : ''}
                  {live.isHost && p.id !== live.me?.id && (
                    <button
                      className="text-button"
                      onClick={() => action('remove', { playerId: p.id })}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {live.joined ? (
              <p>You’re in. Waiting for the first round.</p>
            ) : (
              !live.isHost && joinForm
            )}
          </section>
          <section className="panel live-card">
            {live.isHost ? (
              <>
                <h2>Your role</h2>
                <label className="checkbox-label">
                  <input
                    type="radio"
                    name="host-role"
                    checked={!live.joined}
                    onChange={() => action('leave')}
                  />
                  Host only · watch and control the game
                </label>
                <label className="checkbox-label">
                  <input
                    type="radio"
                    name="host-role"
                    checked={live.joined}
                    onChange={() => {
                      enableCountdownAudio();
                      action('join', { name: name.trim() || live.hostName.slice(0, 24) });
                    }}
                  />
                  Host and play
                </label>
                <p className="small-note">
                  You can watch and control the game, or join as a player.
                </p>
                <button
                  className="button full"
                  disabled={busy || !active.length}
                  onClick={() => action('start')}
                >
                  Start first round <ArrowRight size={18} />
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    const closed = await action('end');
                    if (closed?.phase === 'finished') navigate(publicTrip ? `/p/${id}` : '/');
                  }}
                >
                  Close lobby
                </button>
              </>
            ) : (
              <>
                <h2>How rounds work</h2>
                <p>
                  Each round has a five-second preparation period. Your latest saved pin counts if
                  time runs out.
                </p>
              </>
            )}
            <p>
              {live.settings.nextRoundControl === 'anyPlayer'
                ? 'Any active player can start subsequent rounds.'
                : 'The host starts each round.'}
            </p>
          </section>
        </div>
        {errors}
      </main>
    );
  if (['preparing', 'round'].includes(live.phase))
    return (
      <main className="play-page live-play">
        <PhotoViewer
          key={live.round}
          src={live.photoUrl}
          alt={`Mystery photo for round ${live.round + 1}`}
          onReady={() => {
            setLoadedRound(live.round);
            if (live.me?.active) ready(live.round);
          }}
        />
        {(preparing || loadedRound !== live.round) && (
          <div className="round-preparation" role="status">
            <h1>{preparing ? 'Get ready' : 'Photo is loading…'}</h1>
            {preparing ? (
              <>
                <strong>
                  {Math.max(1, Math.ceil((live.startsAt - now - (live.clockOffsetMs || 0)) / 1000))}
                </strong>
                <p>Everyone starts together.</p>
                <p>
                  {active.filter((p) => p.ready).length} / {active.length} photos loaded
                </p>
              </>
            ) : (
              <p>The round has started. Your timer continues while the photo loads.</p>
            )}
          </div>
        )}
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
            {!preparing && (
              <RoundClock
                deadline={live.deadline}
                serverNow={live.serverNow}
                clockOffsetMs={live.clockOffsetMs}
                audible={!!canGuess}
                onExpire={refresh}
              />
            )}
          </div>
        </header>
        {!preparing && (
          <>
            {(live.me?.guess || !live.me?.active) && (
              <div className="live-waiting" role="status">
                {live.me?.guess
                  ? 'Guess confirmed. Waiting for the group.'
                  : 'You are watching as host.'}
              </div>
            )}
            <MapPanel
              key={live.round}
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
                  <>
                    <CoordinateFields value={pin} onChange={setPin} />
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
                    {pin && (
                      <p className="small-note" role="status">
                        {saveStatus}
                        {saveStatus === 'Saved' ? ' · This pin counts at timeout.' : ''}
                        {saveStatus === 'Couldn’t save' && (
                          <button onClick={retrySave}>Retry saving</button>
                        )}
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    {submitted} of {active.length} players confirmed.
                  </p>
                )}
                {live.settings.timerMode === 'afterFirstLock' && !live.deadline && (
                  <p className="small-note">
                    The {live.settings.afterFirstLockSeconds}-second timer starts when someone
                    confirms.
                  </p>
                )}
                {live.isHost && (
                  <details className="live-host-options">
                    <summary>Host controls</summary>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => action('reveal')}
                    >
                      Reveal now · saved pins count
                    </button>
                    <button className="text-button" disabled={busy} onClick={() => action('end')}>
                      End session
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
          </>
        )}
      </main>
    );
  const finished = live.phase === 'finished',
    actual = live.results[0]?.actual,
    shown = mapFilter === 'mine' ? live.results.filter((p) => p.id === live.me?.id) : live.results;
  return (
    <main className="live-page live-results">
      <div className="live-title">
        <div>
          <h1>{live.title}</h1>
          <h2>{finished ? 'Final scores' : `Round ${live.round + 1} results`}</h2>
        </div>
        {live.photoUrl && (
          <a className="result-photo-link" href={live.photoUrl} target="_blank" rel="noreferrer">
            <img src={live.photoUrl} alt="Photo from this round" />
            <span>View photo</span>
          </a>
        )}
      </div>
      {!finished && (
        <div className="live-results-grid">
          {actual && (
            <section className="panel live-result-map">
              {live.me && (
                <div className="map-filters">
                  <button
                    className="button small outline"
                    aria-pressed={mapFilter === 'all'}
                    onClick={() => setMapFilter('all')}
                  >
                    Everyone
                  </button>
                  <button
                    className="button small outline"
                    aria-pressed={mapFilter === 'mine'}
                    onClick={() => setMapFilter('mine')}
                  >
                    My guess
                  </button>
                </div>
              )}
              <Map actual={actual} guesses={shown} meId={live.me?.id} className="multiplayer-map" />
              <p className="small-note">
                Actual location · Your pin is labeled “You”. Player numbers stay the same each
                round.
              </p>
            </section>
          )}
          <section className="panel live-card">
            <h2>This round</h2>
            <div className="score-scroll">
              <table className="scores-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Distance</th>
                    <th>Points</th>
                    <th>Guessing time</th>
                  </tr>
                </thead>
                <tbody>
                  {live.results.map((p) => (
                    <tr key={p.id} className={p.id === live.me?.id ? 'my-score' : ''}>
                      <th>
                        <span
                          className="player-color"
                          style={{ background: playerColors[(p.marker - 1) % playerColors.length] }}
                        >
                          {p.marker}
                        </span>
                        {p.name}
                        {p.id === live.me?.id ? ' (You)' : ''}
                      </th>
                      <td>{formatDistance(p.distance)}</td>
                      <td>{p.score.toLocaleString()}</td>
                      <td>{duration(p.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
      <section className="panel results-section">
        <h2>Overall standings</h2>
        <Standings rows={live.standings || []} meId={live.me?.id} />
      </section>
      <ScoreMatrix rows={live.standings || []} rounds={live.rounds} live meId={live.me?.id} />
      <div className="live-next">
        {finished ? (
          <button className="button" onClick={() => navigate(publicTrip ? `/p/${id}` : '/')}>
            {publicTrip ? 'Back to trip' : 'Back to my trips'}
          </button>
        ) : live.canAdvance ? (
          <button className="button" disabled={busy} onClick={() => action('next')}>
            {live.round + 1 === live.rounds ? 'Show final scores' : 'Start next round'}{' '}
            <ArrowRight size={18} />
          </button>
        ) : (
          <p role="status">Waiting for the host to start the next round.</p>
        )}
        {!finished && live.isHost && (
          <button className="text-button" disabled={busy} onClick={() => action('end')}>
            End session here
          </button>
        )}
      </div>
      <PhotoCredit credit={live.credit} />
      {finished && live.me?.active && (
        <RoundCards
          id={id}
          results={live.me.results || []}
          photoUrl={(round) =>
            `/api/${publicTrip ? 'publications' : 'games'}/${id}/live/${liveId}/photos/${round}`
          }
        />
      )}
      <PhotoCredit credit={live.credit} />
      {finished && live.me?.active && (
        <ShareActions id={id} source={liveId} notify={notify} publicTrip={publicTrip} />
      )}{' '}
      {errors}
    </main>
  );
}
