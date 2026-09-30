import { useEffect, useState } from 'react';
import { api, json } from './api';
import PhotoCredit from './PhotoCredit';
export default function CommunityAdmin({ navigate }) {
  const [tab, setTab] = useState('reports'),
    [rows, setRows] = useState([]),
    [scores, setScores] = useState([]),
    [scoresCursor, setScoresCursor] = useState(null),
    [lookup, setLookup] = useState(''),
    [cursor, setCursor] = useState(null),
    [selected, setSelected] = useState(null),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  async function load(next) {
    const d = await api(`/admin/${tab}${next ? `?cursor=${encodeURIComponent(next)}` : ''}`);
    setRows((old) => (next ? [...old, ...d.items] : d.items));
    setCursor(d.cursor);
  }
  useEffect(() => {
    setSelected(null);
    setError('');
    load().catch((e) => setError(e.message));
  }, [tab]);
  async function loadScores(id, next) {
    const d = await api(
      `/admin/publications/${id}/scores${next ? `?cursor=${encodeURIComponent(next)}` : ''}`,
    );
    setScores((old) => (next ? [...old, ...d.items] : d.items));
    setScoresCursor(d.cursor);
  }
  useEffect(() => {
    setScores([]);
    setScoresCursor(null);
    if (tab === 'publications' && selected)
      loadScores(selected.id).catch((e) => setError(e.message));
  }, [tab, selected?.id]);
  async function act(path, body) {
    setBusy(true);
    setError('');
    try {
      const d = await api(path, json('POST', body));
      await load();
      setSelected(null);
      setMessage('');
      return d;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="community-page">
      <h1>Operator tools</h1>
      <div className="center-buttons">
        {['reports', 'assets', 'publications', 'profiles'].map((name) => (
          <button
            key={name}
            className={`button ${tab === name ? '' : 'outline'}`}
            onClick={() => setTab(name)}
          >
            {name === 'assets'
              ? 'Photo review'
              : name === 'publications'
                ? 'Public trips'
                : name === 'profiles'
                  ? 'Public profiles'
                  : 'Reports'}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab === 'publications' && (
        <form
          className="catalog-search"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const id = lookup.includes('/p/')
                ? lookup.split('/p/')[1].split(/[/?#]/)[0]
                : lookup.trim();
              setSelected(await api(`/admin/publications/${encodeURIComponent(id)}`));
              setMessage('');
            } catch (e) {
              setError(e.message);
            }
          }}
        >
          <label>
            Public trip link or code
            <input
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              maxLength={250}
              required
            />
          </label>
          <button className="button outline">Find edition</button>
        </form>
      )}
      <div className="admin-layout">
        <section className="panel">
          <h2>
            {tab === 'assets'
              ? 'Official photo pool'
              : tab === 'reports'
                ? 'Private reports'
                : tab === 'profiles'
                  ? 'Public profiles'
                  : 'Public editions'}
          </h2>
          {rows.length === 0 && <p>No records yet.</p>}
          {rows.map((r) => (
            <button
              key={r.id}
              className="admin-row"
              onClick={() => {
                setSelected(r);
                setReviewed(false);
                setMessage('');
              }}
            >
              <strong>
                {r.title || r.credit?.title || r.category || r.nickname || 'Public account'}
              </strong>
              <span>
                {r.status || r.state || (r.suspended ? 'Suspended' : 'Active')} ·{' '}
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </button>
          ))}
          {cursor && (
            <button
              className="text-button"
              onClick={() => load(cursor).catch((e) => setError(e.message))}
            >
              Load more
            </button>
          )}
        </section>
        <section className="panel">
          {!selected ? (
            <p>Select an item to review.</p>
          ) : tab === 'reports' ? (
            <>
              <h2>{selected.category}</h2>
              <p>{selected.target}</p>
              <p>
                {selected.name} {selected.email}
              </p>
              <div className="report-thread">
                {selected.messages.map((m, i) => (
                  <article key={i}>
                    <strong>{m.by}</strong>
                    <p>{m.text}</p>
                  </article>
                ))}
              </div>
              <label>
                Reply / decision
                <textarea
                  rows={6}
                  maxLength={4000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <div className="center-buttons">
                <button
                  className="button"
                  disabled={busy || !message.trim()}
                  onClick={() => act(`/reports/${selected.id}/replies`, { message })}
                >
                  Reply
                </button>
                <button
                  className="button outline"
                  disabled={busy || !message.trim()}
                  onClick={() => act(`/reports/${selected.id}/replies`, { message, close: true })}
                >
                  Reply and close
                </button>
              </div>
            </>
          ) : tab === 'assets' ? (
            <>
              <h2>{selected.credit?.title}</h2>
              <img
                className="review-photo"
                src={`/api/admin/assets/${selected.id}/photo`}
                alt="Candidate for official games"
              />
              <PhotoCredit credit={selected.credit} />
              <p>
                Camera: {selected.lat}, {selected.lng} · {selected.country}
              </p>
              <a
                target="_blank"
                rel="noreferrer"
                href={`https://www.openstreetmap.org/?mlat=${selected.lat}&mlon=${selected.lng}#map=15/${selected.lat}/${selected.lng}`}
              >
                Check camera position on map
              </a>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I checked the source licence, location, image quality, identifiable people and other
                rights.
              </label>
              <div className="center-buttons">
                <button
                  className="button"
                  disabled={busy || !reviewed}
                  onClick={() =>
                    act(`/admin/assets/${selected.id}/review`, {
                      action: 'approve',
                      rightsReviewed: true,
                      locationReviewed: true,
                    })
                  }
                >
                  Approve photo
                </button>
                <button
                  className="button outline"
                  disabled={busy}
                  onClick={() => act(`/admin/assets/${selected.id}/review`, { action: 'reject' })}
                >
                  Withdraw photo
                </button>
              </div>
            </>
          ) : tab === 'profiles' ? (
            <>
              <h2>{selected.nickname || 'Public account'}</h2>
              <p>{selected.suspended ? 'Public activity suspended' : 'Active'}</p>
              <p>{selected.moderationReason}</p>
              <label>
                Reason, shown to the player
                <textarea
                  value={message}
                  maxLength={1000}
                  rows={4}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <button
                className="button"
                disabled={busy || !message.trim()}
                onClick={() =>
                  act(`/admin/profiles/${selected.id}/restriction`, {
                    suspended: !selected.suspended,
                    reason: message,
                  })
                }
              >
                {selected.suspended ? 'Restore public activity' : 'Suspend public activity'}
              </button>
            </>
          ) : (
            <>
              <h2>{selected.title}</h2>
              <p>
                {selected.state} · {selected.hostName}
              </p>
              <button className="text-button" onClick={() => navigate(`/p/${selected.id}`)}>
                Open public page
              </button>
              <label>
                Reason, shown to the creator
                <textarea
                  maxLength={1000}
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <div className="center-buttons">
                <button
                  className="button"
                  disabled={busy || !message.trim()}
                  onClick={() =>
                    act(`/admin/publications/${selected.id}/moderate`, {
                      action: 'remove',
                      reason: message,
                    })
                  }
                >
                  Remove
                </button>
                <button
                  className="button outline"
                  disabled={busy || !message.trim()}
                  onClick={() =>
                    act(`/admin/publications/${selected.id}/moderate`, {
                      action: 'restore',
                      reason: message,
                    })
                  }
                >
                  Restore
                </button>
                <button
                  className="button danger"
                  disabled={busy || !message.trim()}
                  onClick={() =>
                    act(`/admin/publications/${selected.id}/moderate`, {
                      action: 'remove',
                      reason: message,
                      suspendPublisher: true,
                    })
                  }
                >
                  Remove and suspend publisher
                </button>
              </div>
              <h3>Public scores</h3>
              <p className="small-note">
                Use the reason above to remove an inappropriate nickname. Manage account
                restrictions in Public profiles.
              </p>
              {scores.map((score) => (
                <p key={score.id}>
                  {score.name} · {score.score} points{' '}
                  <button
                    className="text-button"
                    disabled={busy || !message.trim()}
                    onClick={() =>
                      act(`/admin/publications/${selected.id}/scores/${score.id}/moderate`, {
                        reason: message,
                      })
                    }
                  >
                    Remove score
                  </button>
                </p>
              ))}
              {scoresCursor && (
                <button
                  className="text-button"
                  onClick={() =>
                    loadScores(selected.id, scoresCursor).catch((e) => setError(e.message))
                  }
                >
                  Load more scores
                </button>
              )}
            </>
          )}
        </section>
      </div>
      {tab === 'assets' && (
        <section className="panel">
          <h2>Daily schedule</h2>
          <p>
            Use at least 150 approved CC0 photos. Existing dates stay unchanged. Scheduling checks
            photo reuse across the preceding month.
          </p>
          <label>
            First date
            <input
              type="date"
              value={date}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              const r = await act('/admin/schedule', { startDate: date, days: 365 });
              if (r) setError(`Scheduled ${r.created} new daily challenges.`);
            }}
          >
            Schedule one year
          </button>
          <p className="small-note">
            After withdrawing a photo, repair future dates from approved spare photos. Current and
            past challenges stay unchanged.
          </p>
          <button
            className="button outline"
            disabled={busy}
            onClick={async () => {
              const r = await act('/admin/repair-schedule', {});
              if (r) setError(`Repaired ${r.repaired} future challenges.`);
            }}
          >
            Repair future dates
          </button>
        </section>
      )}
    </main>
  );
}
