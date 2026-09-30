import DailyCard from './DailyCard';
import { useEffect, useState } from 'react';
import { Compass, Users, Search, Globe2 } from 'lucide-react';
import { api, json, copyLink } from './api';
import { Standings, ScoreMatrix } from './ResultsPanels';
import GameSettings, { defaultSettings, SecondsInput } from './GameSettings';
import Modal from './Modal';
import useRequestGuard from './useRequestGuard';

export function Explore({ navigate }) {
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState(new URLSearchParams(location.search).get('kind') || ''),
    [items, setItems] = useState([]),
    [cursor, setCursor] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const beginRequest = useRequestGuard(JSON.stringify([kind, search]));
  async function load(next, selectedKind = kind, term = search) {
    const isCurrent = beginRequest();
    setBusy(true);
    setError('');
    try {
      const d = await api(
        `/catalog?${new URLSearchParams({ q: term, kind: selectedKind, ...(next ? { cursor: next } : {}) })}`,
      );
      if (!isCurrent()) return;
      setItems((old) => (next ? [...old, ...d.items] : d.items));
      setCursor(d.cursor);
    } catch (e) {
      if (isCurrent()) setError(e.message);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setCursor(null);
    load(null);
  }, [kind, search]);
  return (
    <main className="community-page">
      <div className="section-intro">
        <div>
          <span className="eyebrow">Public trips</span>
          <h1>Explore</h1>
          <p>Play a trip on your own or open a private room for friends.</p>
        </div>
      </div>
      <DailyCard navigate={navigate} />
      <form
        className="catalog-search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(query);
          if (search === query) load(null);
        }}
      >
        <label htmlFor="catalog-query">
          Search titles and tags
          <input
            id="catalog-query"
            maxLength={40}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="City, country, or theme"
          />
        </label>
        <label>
          Show
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All public trips</option>
            <option value="official">Official trips</option>
            <option value="community">Community trips</option>
            <option value="daily">Daily archive</option>
          </select>
        </label>
        <button className="button" disabled={busy}>
          <Search size={17} />
          Search
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="catalog-grid">
        {items.map((p) => (
          <article className="catalog-card panel" key={p.id}>
            <div className={`catalog-art ${p.kind}`}>
              <Globe2 size={48} />
              <span>{p.rounds} photos</span>
            </div>
            <div className="catalog-copy">
              <span className="pill">
                {p.kind === 'community'
                  ? 'Community'
                  : p.kind === 'daily'
                    ? 'Official daily'
                    : 'Official'}
              </span>
              <h2>
                <a
                  href={`/p/${p.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/p/${p.id}`);
                  }}
                >
                  {p.title}
                </a>
              </h2>
              <p>By {p.hostName}</p>
              <div className="tags">
                {p.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <button className="button outline" onClick={() => navigate(`/p/${p.id}`)}>
                Open trip
              </button>
            </div>
          </article>
        ))}
      </div>
      {!busy && !items.length && <p>No public trips match yet. Try another title or tag.</p>}
      {cursor && (
        <button className="button outline" disabled={busy} onClick={() => load(cursor)}>
          Load more
        </button>
      )}
      {busy && <p role="status">Loading trips…</p>}
    </main>
  );
}
export function PublicTrip({ id, navigate, notify, user, signIn }) {
  const [game, setGame] = useState(null),
    [board, setBoard] = useState([]),
    [cursor, setCursor] = useState(null),
    [error, setError] = useState(''),
    [hosting, setHosting] = useState(false),
    [hostingError, setHostingError] = useState(''),
    [existingRoom, setExistingRoom] = useState(null),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [settings, setSettings] = useState({
      ...defaultSettings,
      mode: 'live',
      timerMode: 'fixed',
      timeLimitSeconds: 60,
    });
  async function loadBoard(next) {
    const d = await api(
      `/publications/${id}/leaderboard${next ? `?cursor=${encodeURIComponent(next)}` : ''}`,
    );
    setBoard((old) => (next ? [...old, ...d.items] : d.items));
    setCursor(d.cursor);
  }
  useEffect(() => {
    api(`/publications/${id}`)
      .then((d) => {
        setGame(d.game);
        setName(d.game.nickname || '');
      })
      .catch((e) => setError(e.message));
    loadBoard().catch((e) => setError(e.message));
  }, [id, user?.uid]);
  if (!game)
    return (
      <main className="narrow-page">
        <h1>{error ? 'Trip unavailable' : 'Loading trip…'}</h1>
        <p role="alert">{error}</p>
        <button className="button outline" onClick={() => navigate('/explore')}>
          Explore trips
        </button>
      </main>
    );
  return (
    <main className="community-page">
      <button className="text-button" onClick={() => navigate('/explore')}>
        ← Explore
      </button>
      <section className="public-trip-heading">
        <span className="pill">
          {game.kind === 'community' ? `By ${game.hostName}` : 'Official · TripGuessr'}
        </span>
        <h1>{game.title}</h1>
        <p>
          {game.rounds} photos ·{' '}
          {game.settings.timeLimitSeconds
            ? `${game.settings.timeLimitSeconds} seconds per photo`
            : 'No time limit'}
        </p>
        <div className="center-buttons">
          <button className="button" onClick={() => navigate(`/p/${id}/play`)}>
            <Compass size={19} />
            Play solo
          </button>
          <button className="button outline" onClick={() => (user ? setHosting(true) : signIn())}>
            <Users size={19} />
            Play with friends
          </button>
          <button className="text-button" onClick={() => copyLink(id, notify, true)}>
            Share trip
          </button>
        </div>
        <p className="small-note">
          Guests can play. Public scores need sign-in and an unused first attempt. Friend-room
          results stay within that room.
        </p>
        <a
          href={`/contact?target=${encodeURIComponent(`/p/${id}`)}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`/contact?target=${encodeURIComponent(`/p/${id}`)}`);
          }}
        >
          Report this trip
        </a>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="panel results-section">
        <h2>Public leaderboard</h2>
        <p className="small-note">
          First attempts · points, then guessing time. No photos or guess locations appear in this
          table.
        </p>
        {board.length ? <Standings rows={board} tieBreakTime /> : <p>No ranked scores yet.</p>}
        {cursor && (
          <button
            className="text-button"
            onClick={() => loadBoard(cursor).catch((e) => setError(e.message))}
          >
            Load more scores
          </button>
        )}
      </section>
      {board.length > 0 && <ScoreMatrix rows={board} rounds={game.rounds} />}
      {hosting && (
        <Modal title="Play with friends" close={() => setHosting(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setHostingError('');
              setExistingRoom(null);
              try {
                const r = await api(`/publications/${id}/live`, json('POST', { name, settings }));
                navigate(`/p/${id}/live/${r.id}`);
              } catch (e) {
                setHostingError(e.message);
                if (e.status === 409) {
                  const profile = await api('/public-profile').catch(() => null);
                  setExistingRoom(profile?.activeRoom || null);
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Your host nickname
              <input
                required
                maxLength={24}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <GameSettings value={settings} onChange={setSettings} showMode={false} />
            <p className="small-note">
              You can watch or join as a player. Opening a room uses your first-attempt eligibility
              for this trip, including any ranked attempt still in progress. Share the room link
              with your friends.
            </p>
            {hostingError && (
              <p className="error" role="alert">
                {hostingError}
              </p>
            )}
            {existingRoom && (
              <button
                type="button"
                className="button outline"
                onClick={() => navigate(`/p/${existingRoom.publicationId}/live/${existingRoom.id}`)}
              >
                Open existing lobby
              </button>
            )}
            <button className="button" disabled={busy}>
              Create private room
            </button>
          </form>
        </Modal>
      )}
    </main>
  );
}
export function PublishTrip({ game, close, notify, navigate }) {
  const [existing, setExisting] = useState(null),
    [loaded, setLoaded] = useState(false),
    [title, setTitle] = useState(game.title),
    [nickname, setNickname] = useState(game.hostName || ''),
    [tags, setTags] = useState(''),
    [seconds, setSeconds] = useState(60),
    [untimed, setUntimed] = useState(false),
    [rights, setRights] = useState(false),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    api(`/games/${game.id}/publication`)
      .then(setExisting)
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [game.id]);
  return (
    <Modal title="Public sharing" close={close}>
      {!loaded ? (
        <p>Loading…</p>
      ) : existing?.state === 'published' ? (
        <>
          <p>
            This trip has a public edition. Its leaderboard is separate from your original unlisted
            trip.
          </p>
          <input
            readOnly
            value={`${location.origin}/p/${existing.id}`}
            aria-label="Public trip link"
          />
          <div className="modal-actions">
            <button className="button" onClick={() => navigate(`/p/${existing.id}`)}>
              Open public trip
            </button>
            <button
              className="button outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/publications/${existing.id}`, { method: 'DELETE' });
                  notify('Public edition removed. Your original unlisted link still works.');
                  close();
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove public edition
            </button>
          </div>
        </>
      ) : existing?.state === 'removed' ? (
        <>
          <p>This edition was removed by moderation.</p>
          <p>{existing.reason}</p>
          <button
            className="button outline"
            onClick={() => navigate(`/contact?target=${encodeURIComponent(`/p/${existing.id}`)}`)}
          >
            Request review
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const p = await api(
                `/games/${game.id}/publication`,
                json('POST', {
                  title,
                  nickname,
                  tags: tags
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  timeLimitSeconds: untimed ? 0 : seconds,
                  rightsConfirmed: rights,
                  visibilityConfirmed: visible,
                }),
              );
              notify('Your public trip is available in Explore.');
              navigate(`/p/${p.id}`);
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            Publish a separate edition in Explore. Previous players’ names and scores stay on your
            original link.
          </p>
          {existing && (
            <p>Republishing restores the same photos, title, timer and first-attempt records.</p>
          )}
          <label>
            Public title
            <input
              required
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!!existing}
            />
          </label>
          <label>
            Public creator nickname
            <input
              required
              maxLength={24}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={!!existing}
            />
          </label>
          <label>
            Tags, separated by commas (up to five)
            <input
              maxLength={124}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={!!existing}
              placeholder="Japan, cities, nature"
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={untimed}
              onChange={(e) => setUntimed(e.target.checked)}
              disabled={!!existing}
            />
            No time limit
          </label>
          {!untimed && (
            <SecondsInput
              id="public-seconds"
              label="Time per photo"
              value={seconds}
              onChange={setSeconds}
            />
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              required
              checked={rights}
              onChange={(e) => setRights(e.target.checked)}
            />
            I have the right to publish these photos, including permission where needed from people
            shown.
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              required
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
            />
            Anyone can find and play this trip, see its photos and locations, and create a friend
            room. People can save or copy the content.
          </label>
          <p className="small-note">
            Search engines are asked not to index trip pages. This is not a guarantee of privacy.
            Publishing does not give other users ownership of your photos.
          </p>
          <button className="button" disabled={busy || !rights || !visible}>
            {existing ? 'Restore public edition' : 'Publish trip'}
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
