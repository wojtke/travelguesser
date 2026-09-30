import { Standings, ScoreMatrix, RoundCards, ShareActions } from './ResultsPanels';
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
import RoundClock, { enableCountdownAudio } from './RoundClock';
import PhotoCredit from './PhotoCredit';
import CoordinateFields from './CoordinateFields';
export default function Game({ id, navigate, notify, publicTrip = false, user, signIn }) {
  const base = `/${publicTrip ? 'publications' : 'games'}/${id}`;
  const [ranked, setRanked] = useState(false);
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
    api(`${base}`)
      .then((data) => {
        if (data.game.liveId) {
          navigate(`/g/${id}/live/${data.game.liveId}`);
          return;
        }
        setGame(data.game);
        if (!data.game.canRank) setRanked(false);
        if (publicTrip) setName(data.game.nickname || '');
        setRun(data.run);
        if (data.run?.awaitingNext) setResult(data.run.results.at(-1));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, user?.uid]);
  useEffect(() => {
    if (run?.completed) {
      api(`${base}/leaderboard`)
        .then((data) => setBoard(Array.isArray(data) ? data : data.items))
        .catch((e) => notify(e.message));
    }
  }, [run?.completed, id]);
  async function join(e) {
    e.preventDefault();
    enableCountdownAudio();
    setBusy(true);
    setError('');
    try {
      const data = await api(
        `${base}/join`,
        json('POST', { name, ranked: publicTrip && ranked, consent: publicTrip && ranked }),
      );
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
        `${base}/guess`,
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
      if (!run.completed) setRun(await api(`${base}/round`, json('POST', { round: run.round })));
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
            {publicTrip && (
              <div className="public-play-choice">
                {game.canRank ? (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={ranked}
                      onChange={(e) => setRanked(e.target.checked)}
                    />
                    Count my first attempt and publish my nickname, scores and completion time.
                  </label>
                ) : (
                  <p className="small-note">
                    {game.signedIn
                      ? 'Practice play. Ranked first attempts are unavailable for this account or date.'
                      : 'Play as a guest for practice, or sign in before starting to enter the public leaderboard.'}
                  </p>
                )}
                {!game.signedIn && (
                  <button type="button" className="button outline" onClick={signIn}>
                    Sign in with Google
                  </button>
                )}
                <p className="small-note">
                  {ranked
                    ? 'One ranked attempt. Opening or joining a friend room for this trip before finishing changes this attempt to practice.'
                    : game.signedIn
                      ? 'Practice scores are not published. Starting practice uses your first attempt: you cannot submit a ranked score for this trip afterwards.'
                      : 'Starting guest practice uses the first attempt in this browser. Sign in before starting if you want a ranked score for this trip.'}
                </p>
              </div>
            )}

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
              {busy ? <LoaderCircle className="spin" size={18} /> : <Compass size={18} />}
              {publicTrip ? (ranked ? 'Start ranked attempt' : 'Start practice') : 'Start game'}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="small-note">
            <LockKeyhole size={13} />{' '}
            {publicTrip && game.signedIn
              ? 'Your progress is saved to your account.'
              : 'No sign-up needed for practice. Your progress is saved in this browser.'}
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
          <ShareActions id={id} notify={notify} publicTrip={publicTrip} />
          {publicTrip && (
            <div className="center-buttons">
              <p>
                {run.ranked
                  ? 'Ranked first attempt'
                  : run.rankReason || 'Practice result — not on the public leaderboard.'}
              </p>
              <button
                className="button outline"
                onClick={async () => {
                  try {
                    setRun(
                      await api(`${base}/join`, json('POST', { name: run.name, restart: true })),
                    );
                    setResult(null);
                    setPin(null);
                  } catch (e) {
                    notify(e.message);
                  }
                }}
              >
                Play again for practice
              </button>
              {run.ranked && (
                <button
                  className="text-button"
                  onClick={async () => {
                    try {
                      await api(`${base}/leaderboard/me`, { method: 'DELETE' });
                      setBoard((rows) => rows.filter((r) => r.id !== run.publicId));
                      notify(
                        'Your public score was removed. This does not restore your ranked attempt.',
                      );
                    } catch (e) {
                      notify(e.message);
                    }
                  }}
                >
                  Remove my public score
                </button>
              )}
              <button className="text-button" onClick={() => navigate(`/p/${id}`)}>
                Back to public trip
              </button>
            </div>
          )}
          <button className="button outline" onClick={() => navigate('/')}>
            Back home
          </button>
        </div>
        <RoundCards
          id={id}
          results={run.results}
          photoUrl={(round) => `/api${base}/photos/${round}`}
        />
        <section className="panel results-section">
          <h2>Leaderboard</h2>
          <Standings rows={board} meId={run.publicId} tieBreakTime={publicTrip} />
          <button
            className="text-button"
            onClick={() =>
              api(`${base}/leaderboard`)
                .then((data) => setBoard(Array.isArray(data) ? data : data.items))
                .catch((e) => notify(e.message))
            }
          >
            Refresh scores
          </button>
        </section>
        <ScoreMatrix rows={board} rounds={game.rounds} meId={run.publicId} />
      </main>
    );
  const round = result ? result.round : run.round;
  return (
    <main className="play-page">
      <PhotoViewer
        key={`photo-${round}`}
        src={`/api${base}/photos/${round}`}
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
              clockOffsetMs={run.clockOffsetMs}
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
            {publicTrip && run.rankReason && (
              <p className="small-note" role="status">
                {run.rankReason}
              </p>
            )}
            <PhotoCredit credit={result.credit} />
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
