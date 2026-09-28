import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  MapPin,
  Compass,
  Camera,
  Users,
  LockKeyhole,
  Trophy,
  LoaderCircle,
} from 'lucide-react';
import { api, json, formatDistance, copyLink } from './api';
import Map from './Map';
import PhotoViewer from './PhotoViewer';
import MapPanel from './MapPanel';
import RoundClock from './RoundClock';
import CoordinateFields from './CoordinateFields';
export default function Game({ id, navigate, notify }) {
  const [game, setGame] = useState(null),
    [run, setRun] = useState(null),
    [name, setName] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [pin, setPin] = useState(null),
    [result, setResult] = useState(null),
    [board, setBoard] = useState([]),
    [loading, setLoading] = useState(true);
  const submitting = useRef(false);
  useEffect(() => {
    api(`/games/${id}`)
      .then((data) => {
        if (data.game.liveId) {
          navigate(`/g/${id}/live/${data.game.liveId}`);
          return;
        }
        setGame(data.game);
        setRun(data.run);
        if (data.run?.awaitingNext) setResult(data.run.results.at(-1));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => {
    if (run?.completed) {
      api(`/games/${id}/leaderboard`)
        .then(setBoard)
        .catch((e) => notify(e.message));
    }
  }, [run?.completed, id]);
  async function join(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api(`/games/${id}/join`, json('POST', { name }));
      setRun(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function guess(timedOut = false) {
    if ((!pin && !timedOut) || submitting.current || result || !run || run.completed) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await api(
        `/games/${id}/guess`,
        json('POST', { ...pin, timedOut: timedOut === true, round: run.round }),
      );
      setResult(data.result);
      setRun(data.run);
    } catch (e) {
      setError(e.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function nextRound() {
    if (busy) return;
    setBusy(true);
    try {
      if (!run.completed && game.settings.timeLimitSeconds)
        setRun(await api(`/games/${id}/round`, json('POST', { round: run.round })));
      setResult(null);
      setPin(null);
      setError('');
      document.activeElement?.blur();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!run || run.completed || result) return;
    const onKey = (event) => {
      if (
        (event.code !== 'Space' && event.key !== ' ') ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.defaultPrevented
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="dialog"]',
        )
      )
        return;
      event.preventDefault();
      if (pin && !busy) guess();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, result, pin, busy]);
  if (loading)
    return (
      <div className="loading-page">
        <LoaderCircle className="spin" /> Loading trip…
      </div>
    );
  if (!game)
    return (
      <main className="narrow-page">
        <Compass size={38} />
        <h1>Trip not found</h1>
        <p role="alert">{error}</p>
        <button className="button" onClick={() => navigate('/')}>
          Back home
        </button>
      </main>
    );
  if (!run)
    return (
      <main className="join-page">
        <div className="join-art">
          <img src="/images/mountains.jpg" alt="Sunlit mountain peaks" />
        </div>
        <div className="join-form">
          <span className="pill">
            <Users size={15} /> {game.demo ? 'Demo trip' : `Hosted by ${game.hostName}`}
          </span>
          <h1>{game.title}</h1>
          <p>
            Guess the location of each photo. Closer guesses earn more points.{' '}
            {game.settings.timeLimitSeconds
              ? `${game.settings.timeLimitSeconds} seconds per photo. The timer starts when you start each round.`
              : 'No time limit.'}
          </p>
          <div className="game-facts">
            <span>
              <Camera size={18} />
              <b>{game.rounds}</b> rounds
            </span>
            <span>
              <Trophy size={18} />
              <b>{(game.rounds * 5000).toLocaleString()}</b> possible points
            </span>
          </div>
          <form onSubmit={join}>
            <label htmlFor="player-name">Your name</label>
            <input
              id="player-name"
              placeholder="Name or nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={24}
              required
              autoComplete="nickname"
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button full" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <Compass size={18} />} Start
              game <ArrowRight size={18} />
            </button>
          </form>
          <p className="small-note">
            <LockKeyhole size={13} /> No sign-up. Your progress is saved in this browser.
          </p>
        </div>
      </main>
    );
  if (run.completed && !result)
    return (
      <main className="results-page">
        <div className="results-hero">
          <span className="success-icon">
            <Trophy size={35} />
          </span>
          <h1>Results</h1>
          <p>
            {run.name} · {game.title}
          </p>
          <div className="total-score">
            {run.score.toLocaleString()}
            <span>/ {(game.rounds * 5000).toLocaleString()} points</span>
          </div>
          <div className="center-buttons">
            <button className="button" onClick={() => copyLink(id, notify)}>
              Share trip <ArrowUpRight size={18} />
            </button>
            <button className="button outline" onClick={() => navigate('/')}>
              Back home
            </button>
          </div>
        </div>
        <div className="results-columns">
          <section className="panel round-summary">
            <h2>Round results</h2>
            {run.results.map((r, i) => (
              <div className="summary-row" key={i}>
                <img src={`/api/games/${id}/photos/${i}`} alt={`Photo from round ${i + 1}`} />
                <div>
                  <span className="eyebrow">ROUND {i + 1}</span>
                  <p>{formatDistance(r.distance)} away</p>
                </div>
                <strong>
                  {r.score.toLocaleString()}
                  <small> pts</small>
                </strong>
              </div>
            ))}
          </section>
          <section className="panel leaderboard">
            <div className="leaderboard-title">
              <h2>Leaderboard</h2>
              <Trophy size={23} />
            </div>
            {board.length ? (
              board.map((entry, i) => (
                <div key={`${entry.name}-${i}`} className="leaderboard-row">
                  <span className={`rank ${i === 0 ? 'first' : ''}`}>
                    {i === 0 ? <Trophy size={16} /> : String(i + 1).padStart(2, '0')}
                  </span>
                  <b>{entry.name}</b>
                  <span>
                    {entry.score.toLocaleString()} <small>pts</small>
                  </span>
                </div>
              ))
            ) : (
              <p className="small-note">Scores appear here when players finish.</p>
            )}
            <button
              className="text-button"
              onClick={() =>
                api(`/games/${id}/leaderboard`)
                  .then(setBoard)
                  .catch((e) => notify(e.message))
              }
            >
              Refresh scores <ArrowRight size={15} />
            </button>
          </section>
        </div>
      </main>
    );
  const round = result ? result.round : run.round;
  return (
    <main className="play-page">
      <PhotoViewer
        key={`photo-${round}`}
        src={`/api/games/${id}/photos/${round}`}
        alt={`Mystery location for round ${round + 1}`}
      />
      <header className="play-heading">
        <button className="play-home" aria-label="Back home" onClick={() => navigate('/')}>
          <ArrowLeft size={19} />
        </button>
        <div className="play-trip">
          <span className="eyebrow">{game.title}</span>
          <h1>{result ? 'Round result' : 'Where was this photo taken?'}</h1>
        </div>
        <div className="play-stats">
          {!result && (
            <RoundClock
              deadline={run.deadline}
              serverNow={run.serverNow}
              onExpire={() => guess(true)}
            />
          )}
          <span>
            <Camera size={16} />
            <b>{round + 1}</b> / {game.rounds}
          </span>
          <span>
            <Trophy size={16} />
            <b>{run.score.toLocaleString()}</b> <span>pts</span>
          </span>
        </div>
        <div className="round-progress" aria-label={`Round ${round + 1} of ${game.rounds}`}>
          {Array.from({ length: game.rounds }, (_, i) => (
            <span key={i} className={i < run.round ? 'done' : i === round ? 'current' : ''} />
          ))}
        </div>
      </header>
      <MapPanel key={`map-${round}`} result={!!result} pin={!!pin}>
        <Map
          key={`${round}-${!!result}`}
          value={result ? result.guess : pin}
          actual={result?.actual}
          onChange={result ? undefined : setPin}
          className="guess-map"
        />
        {result ? (
          <div className="round-result">
            <div className="map-legend">
              <span>
                <i className="guess-dot" /> Your guess
              </span>
              <span>
                <i className="actual-dot" /> Actual location
              </span>
            </div>
            <div className="result-numbers">
              <div>
                <span>DISTANCE</span>
                <b>{formatDistance(result.distance)}</b>
              </div>
              <div>
                <span>ROUND SCORE</span>
                <b>
                  +{result.score.toLocaleString()} <small>pts</small>
                </b>
              </div>
            </div>
            {result.caption && <p className="reveal-caption">{result.caption}</p>}
            <button className="button full" disabled={busy} onClick={nextRound}>
              {run.completed ? 'See results' : 'Next photo'} <ArrowRight size={18} />
            </button>
          </div>
        ) : (
          <div className="guess-controls">
            <CoordinateFields value={pin} onChange={setPin} />
            <button
              className="button full"
              disabled={!pin || busy}
              onClick={() => guess()}
              aria-keyshortcuts="Space"
            >
              {busy ? <LoaderCircle className="spin" size={18} /> : <MapPin size={17} />}{' '}
              {pin ? 'Confirm guess' : 'Drop a pin to guess'} {pin && <kbd>SPACE</kbd>}
            </button>
            <small>
              {pin ? 'Press Space to confirm your guess.' : 'Tap the map to choose a location.'}
            </small>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </MapPanel>
    </main>
  );
}
