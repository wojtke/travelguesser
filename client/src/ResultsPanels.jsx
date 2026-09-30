import { useEffect, useRef, useState } from 'react';
import Map from './Map';
import PhotoCredit from './PhotoCredit';
import { api, json, copyLink, formatDistance } from './api';
export function duration(ms) {
  if (ms == null) return '—';
  const seconds = Math.round(ms / 1000);
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function finished(value) {
  return value ? new Date(value).toLocaleString() : '—';
}
export const rankAt = (rows, i, tieBreakTime = false) =>
  1 +
  rows.filter(
    (p) =>
      p.score > rows[i].score ||
      (tieBreakTime && p.score === rows[i].score && p.durationMs < rows[i].durationMs),
  ).length;
export function Standings({ rows, meId, tieBreakTime = false }) {
  return (
    <div className="score-scroll">
      <table className="scores-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>Points</th>
            <th>Guessing time</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.id || i} className={p.id && p.id === meId ? 'my-score' : ''}>
              <td>
                {rankAt(rows, i, tieBreakTime)}
                {rankAt(rows, i, tieBreakTime) === 1 ? ' 🏆' : ''}
              </td>
              <th scope="row">
                {p.name}
                {p.id && p.id === meId ? ' (You)' : ''}
                {p.active === false ? ' · Left' : ''}
              </th>
              <td>{p.score.toLocaleString()}</td>
              <td>{duration(p.durationMs)}</td>
              <td>{finished(p.finishedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ScoreMatrix({ rows, rounds, live = false, meId }) {
  return (
    <section className="panel results-section">
      <h2>Round-by-round scores</h2>
      <p className="small-note">
        {live
          ? 'Points for each round.'
          : 'Columns identify the same photo even when players saw a shuffled order.'}{' '}
        — = not available.
      </p>
      <div className="score-scroll">
        <table className="scores-table">
          <thead>
            <tr>
              <th>Player</th>
              {Array.from({ length: rounds }, (_, i) => (
                <th key={i}>
                  {live ? 'Round' : 'Photo'} {i + 1}
                </th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.id || i} className={p.id && p.id === meId ? 'my-score' : ''}>
                <th scope="row">
                  {p.name}
                  {p.id && p.id === meId ? ' (You)' : ''}
                </th>
                {Array.from({ length: rounds }, (_, n) => {
                  const r = p.rounds?.find((r) => (live ? r.round : r.photoIndex) === n);
                  return <td key={n}>{r ? r.score.toLocaleString() : '—'}</td>;
                })}
                <td>{p.score.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function MiniMap({ result }) {
  const ref = useRef(),
    [visible, setVisible] = useState(false),
    [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={`result-mini ${expanded ? 'expanded' : ''}`}>
      {visible ? (
        <Map
          key={expanded ? 'expanded' : 'mini'}
          value={result.guess}
          actual={result.actual}
          interactive={expanded}
          className="mini-map"
        />
      ) : (
        <div className="mini-map-placeholder" aria-hidden="true" />
      )}
      <button className="text-button" onClick={() => setExpanded((v) => !v)}>
        {expanded ? 'Collapse map' : 'Expand map'}
      </button>
      <p className="small-note">Your guess → actual location</p>
    </div>
  );
}
export function RoundCards({ id, results, photoUrl }) {
  return (
    <section className="panel results-section">
      <h2>Round results</h2>
      <div className="round-cards">
        {results.map((r, i) => (
          <article className="round-card" key={r.round ?? i}>
            <img
              loading="lazy"
              src={photoUrl ? photoUrl(r.round ?? i) : `/api/games/${id}/photos/${r.round ?? i}`}
              alt={`Photo from round ${(r.round ?? i) + 1}`}
            />
            <h3>Round {(r.round ?? i) + 1}</h3>
            <p>
              {formatDistance(r.distance)} · <strong>{r.score.toLocaleString()} pts</strong> ·{' '}
              {duration(r.durationMs)}
            </p>
            {r.caption && <p>{r.caption}</p>}
            <PhotoCredit credit={r.credit} />
            {r.actual && <MiniMap result={r} />}
          </article>
        ))}
      </div>
    </section>
  );
}
export function ShareActions({ id, source = 'solo', notify, publicTrip = false }) {
  const [url, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function share() {
    setBusy(true);
    setError('');
    try {
      const data = await api(
        `/${publicTrip ? 'publications' : 'games'}/${id}/results/share`,
        json('POST', { source }),
      );
      const link = location.origin + data.url;
      setUrl(link);
      try {
        await navigator.clipboard.writeText(link);
        notify('Your result link was copied.');
      } catch {
        notify('Copy your result link below.');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="share-actions">
      <div className="center-buttons">
        <button className="button outline" onClick={() => copyLink(id, notify, publicTrip)}>
          Invite to trip
        </button>
        <button className="button" disabled={busy} onClick={share}>
          {busy ? 'Creating link…' : 'Share my results'}
        </button>
      </div>
      <p className="small-note">
        Invitations open the game. Result links show your nickname, scores and timing, with no
        photos or locations, for 30 days.
      </p>
      {url && (
        <label>
          Your results link
          <input
            aria-label="Your results link"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
export default function SharedResults({ id, token, navigate, publicTrip = false }) {
  const [result, setResult] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    api(`/${publicTrip ? 'publications' : 'games'}/${id}/results/${token}`)
      .then(setResult)
      .catch((e) => setError(e.message));
  }, [id, token]);
  if (!result)
    return (
      <main className="narrow-page">
        <h1>{error ? 'Result unavailable' : 'Loading results…'}</h1>
        <p role="alert">{error}</p>
      </main>
    );
  return (
    <main className="results-page">
      <h1>{result.name}’s results</h1>
      <p>{result.title} · Shared results, not your own game</p>
      <p className="total-score">
        {result.score.toLocaleString()}
        <span>points</span>
      </p>
      <p>
        Guessing time: {duration(result.durationMs)} · Completed: {finished(result.finishedAt)}
      </p>
      <button className="button" onClick={() => navigate(`/${publicTrip ? 'p' : 'g'}/${id}`)}>
        Play this trip
      </button>
      <p className="small-note">
        No photos or locations are revealed here. Link expires {finished(result.expiresAt)}.
      </p>
      <section className="panel results-section">
        <h2>Round scores</h2>
        <div className="score-scroll">
          <table className="scores-table">
            <thead>
              <tr>
                <th>Round</th>
                <th>Points</th>
                <th>Distance</th>
                <th>Guessing time</th>
              </tr>
            </thead>
            <tbody>
              {result.rounds.map((r, i) => (
                <tr key={i}>
                  <th>{i + 1}</th>
                  <td>{r.score.toLocaleString()}</td>
                  <td>{formatDistance(r.distance)}</td>
                  <td>{duration(r.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
