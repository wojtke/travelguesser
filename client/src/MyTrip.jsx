import { useState } from 'react';
import {
  Camera,
  ChevronDown,
  Copy,
  Globe,
  Link,
  Lock,
  Pencil,
  Play,
  Trash2,
  Users,
} from 'lucide-react';
import { copyLink } from './api';

export default function MyTrip({
  game,
  navigate,
  notify,
  hostLive,
  toggleSharing,
  publish,
  remove,
}) {
  const [expanded, setExpanded] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  async function changeSharing() {
    setSharingBusy(true);
    try {
      await toggleSharing(game);
    } finally {
      setSharingBusy(false);
    }
  }
  return (
    <article className="trip-card" aria-labelledby={`trip-title-${game.id}`}>
      <div className="my-trip-row">
        <div className="trip-photo-stack" aria-label={`${game.rounds} photos · owner preview`}>
          {Array.from({ length: Math.min(game.rounds, 3) }, (_, i) => (
            <TripThumbnail
              key={`${game.tripRevision || 0}-${i}`}
              src={`/api/games/${game.id}/edit/photos/${i}?revision=${game.tripRevision || 0}&thumbnail=1`}
              index={i}
            />
          ))}
        </div>
        <div className="my-trip-info">
          <h3 id={`trip-title-${game.id}`}>{game.title}</h3>
          <div className="my-trip-meta">
            <span>
              {game.rounds} {game.rounds === 1 ? 'photo' : 'photos'}
            </span>
            <span>
              Created{' '}
              {new Date(game.createdAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>
          <div className="my-trip-status" id={`trip-status-${game.id}`}>
            <span className={`trip-access ${game.sharing ? '' : 'paused'}`}>
              {game.sharing ? <Link size={12} /> : <Lock size={12} />}
              {game.sharing ? 'Link sharing on' : 'Link sharing paused'}
            </span>
            {game.liveId && game.sharing && <span className="trip-live-status">Lobby open</span>}
          </div>
        </div>
        <div className="my-trip-actions">
          <button className="button small" onClick={() => navigate(`/g/${game.id}/edit`)}>
            <Pencil size={15} /> Edit trip
          </button>
          {game.sharing ? (
            <button className="button outline small" onClick={() => copyLink(game.id, notify)}>
              <Copy size={15} /> Copy trip link
            </button>
          ) : (
            <button className="button outline small" disabled={sharingBusy} onClick={changeSharing}>
              <Link size={15} /> {sharingBusy ? 'Enabling…' : 'Enable sharing'}
            </button>
          )}
          <button
            className="button outline small"
            disabled={!game.sharing || sharingBusy}
            aria-describedby={`trip-status-${game.id}`}
            title={
              !game.sharing ? 'Enable link sharing to invite friends to a live game.' : undefined
            }
            onClick={() => hostLive(game)}
          >
            <Users size={15} /> {game.liveId ? 'Open lobby' : 'Host live'}
          </button>
          <button
            className="button outline small trip-more-toggle"
            aria-expanded={expanded}
            aria-controls={`trip-options-${game.id}`}
            onClick={() => setExpanded(!expanded)}
          >
            More options <ChevronDown size={15} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="my-trip-more" id={`trip-options-${game.id}`}>
          <div className="my-trip-secondary">
            <button className="text-button" onClick={() => navigate(`/g/${game.id}`)}>
              <Play size={15} /> Open trip
            </button>
            {publish && (
              <button className="text-button" onClick={() => publish(game)}>
                <Globe size={15} /> Public sharing
              </button>
            )}
            {game.sharing && (
              <button className="text-button" disabled={sharingBusy} onClick={changeSharing}>
                <Lock size={15} /> {sharingBusy ? 'Pausing…' : 'Pause link sharing'}
              </button>
            )}
          </div>
          <button className="text-button trip-delete" onClick={() => remove(game)}>
            <Trash2 size={15} /> Delete trip
          </button>
        </div>
      )}
    </article>
  );
}

function TripThumbnail({ src, index }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`trip-stack-photo trip-stack-photo-${index}`} aria-hidden="true">
      {failed ? (
        <Camera size={23} />
      ) : (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      )}
    </div>
  );
}
