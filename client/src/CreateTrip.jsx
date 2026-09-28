import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  MapPin,
  Camera,
  Check,
  Copy,
  Plus,
  LockKeyhole,
  Trash2,
  ImagePlus,
  LoaderCircle,
} from 'lucide-react';
import { api, preparePhoto, copyLink } from './api';
import Map from './Map';
import LocationSearch from './LocationSearch';
import CoordinateFields from './CoordinateFields';
import GameSettings, { defaultSettings } from './GameSettings';
import { readPhotoLocation } from './photo-location';
export default function CreateTrip({ user, navigate, notify, signIn }) {
  const [photos, setPhotos] = useState([]),
    [selected, setSelected] = useState(0),
    [title, setTitle] = useState(''),
    [hostName, setHostName] = useState(user?.name || '');
  const [busy, setBusy] = useState(false),
    [preparing, setPreparing] = useState(false),
    [error, setError] = useState(''),
    [created, setCreated] = useState(null),
    [drag, setDrag] = useState(false);
  const [usage, setUsage] = useState(null),
    [settings, setSettings] = useState(defaultSettings);
  useEffect(() => {
    api('/host/usage')
      .then(setUsage)
      .catch((e) => setError(e.message));
  }, []);
  const input = useRef(null),
    photoRef = useRef(photos);
  photoRef.current = photos;
  useEffect(() => () => photoRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);
  const current = photos[selected];
  const update = (changes) =>
    setPhotos((list) => list.map((p, i) => (i === selected ? { ...p, ...changes } : p)));
  async function addFiles(files) {
    if (preparing) return;
    setPreparing(true);
    setError('');
    const allowed = [...files].slice(0, 12 - photos.length);
    if (files.length > allowed.length) notify('A trip can have up to 12 photos.');
    const added = [];
    for (const file of allowed) {
      try {
        const metadata = await readPhotoLocation(file);
        const prepared = await preparePhoto(file);
        added.push({
          ...prepared,
          ...metadata,
          id: crypto.randomUUID(),
          name: file.name,
          caption: '',
        });
      } catch (e) {
        setError(e.message);
      }
    }
    setPhotos((list) => [...list, ...added]);
    if (added.length) setSelected(photos.length);
    setPreparing(false);
  }
  async function publish(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData();
    form.append(
      'metadata',
      JSON.stringify({
        title,
        hostName,
        settings,
        photos: photos.map((p) => ({ ...p.location, caption: p.caption })),
      }),
    );
    photos.forEach((p) => form.append('photos', p.file, 'photo.jpg'));
    try {
      const game = await api('/games', { method: 'POST', body: form });
      if (game.liveId) navigate(`/g/${game.id}/live/${game.liveId}`);
      else setCreated(game);
    } catch (e) {
      setError(e.message);
      if (e.status === 401) signIn();
    } finally {
      setBusy(false);
    }
  }
  const missing = photos.filter((p) => !p.location).length;
  if (created)
    return (
      <main className="narrow-page created-page">
        <span className="success-icon">
          <Check size={35} />
        </span>
        <h1>Trip created</h1>
        <p>
          “{created.title}” has {created.rounds} {created.rounds === 1 ? 'photo' : 'photos'}. Share
          the link so friends can play.
        </p>
        <div className="share-box">
          <input
            aria-label="Trip invite link"
            readOnly
            value={`${location.origin}/g/${created.id}`}
            onFocus={(e) => e.target.select()}
          />
          <button className="button" onClick={() => copyLink(created.id, notify)}>
            <Copy size={17} /> Copy link
          </button>
        </div>
        <div className="center-buttons">
          <button className="button outline" onClick={() => navigate(`/g/${created.id}`)}>
            Open trip <ArrowUpRight size={17} />
          </button>
          <button className="text-button" onClick={() => navigate('/')}>
            Back to my trips
          </button>
        </div>
        <p className="small-note">
          <LockKeyhole size={14} /> Anyone with this trip link can play and see its photos.
        </p>
      </main>
    );
  return (
    <main className="create-page">
      <button className="back-link" onClick={() => navigate('/')}>
        <ArrowLeft size={16} /> Back to my trips
      </button>
      <div className="page-heading">
        <div>
          <h1>Create a trip</h1>
          <p>Upload photos and confirm where each one was taken.</p>
        </div>
        <span className="page-badge">
          <Camera size={17} /> 1–12 photos per trip
        </span>
      </div>
      {usage && (
        <p
          className={`creator-quota ${usage.trips >= usage.limits.activeTrips ? 'error' : ''}`}
          role="status"
        >
          {usage.trips} / {usage.limits.activeTrips} trips in your collection.
          {usage.trips >= usage.limits.activeTrips
            ? ' Delete a trip from My trips to make room.'
            : ' Friends can play without an account.'}
        </p>
      )}
      <form onSubmit={publish}>
        <div className="trip-details panel">
          <div className="section-number">01</div>
          <div className="field">
            <label htmlFor="title">Trip name</label>
            <input
              id="title"
              placeholder="e.g. Japan 2026"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={80}
            />
          </div>
          <div className="field host-name">
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              placeholder="Your display name"
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
              required
              maxLength={30}
            />
          </div>
        </div>
        <GameSettings value={settings} onChange={setSettings} />
        <div className="upload-heading">
          <div>
            <span className="section-number">02</span>
            <h2>Upload photos</h2>
          </div>
          <span>{photos.length} / 12 photos</span>
        </div>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          ref={input}
          className="sr-only"
          aria-label="Upload travel photos"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {!photos.length ? (
          <button
            type="button"
            className={`dropzone ${drag ? 'dragging' : ''}`}
            onClick={() => input.current.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              addFiles(e.dataTransfer.files);
            }}
            disabled={preparing}
          >
            <span className="drop-icon">
              {preparing ? (
                <LoaderCircle className="spin" size={30} />
              ) : (
                <ImagePlus size={30} strokeWidth={1.5} />
              )}
            </span>
            <h3>{preparing ? 'Processing photos…' : 'Add photos'}</h3>
            <p>
              Drag photos here, or <span>browse your files</span>
            </p>
            <small>JPG, PNG or WebP · Up to 25 MB each · GPS detected automatically</small>
          </button>
        ) : (
          <div className="photo-workspace panel">
            <div className="photo-rail">
              {photos.map((p, i) => (
                <button
                  type="button"
                  key={p.id}
                  className={`photo-thumb ${selected === i ? 'selected' : ''}`}
                  onClick={() => setSelected(i)}
                  aria-label={`Edit photo ${i + 1}${p.location ? ', location set' : ', needs a location'}`}
                >
                  <img src={p.url} alt={`Trip photo ${i + 1}`} />
                  <span className="thumb-number">{i + 1}</span>
                  <span className={`thumb-status ${p.location ? 'set' : ''}`}>
                    {p.location ? <Check size={11} /> : <MapPin size={11} />}
                  </span>
                </button>
              ))}
              {photos.length < 12 && (
                <button
                  type="button"
                  className="add-photo"
                  onClick={() => input.current.click()}
                  disabled={preparing}
                  aria-label="Add more photos"
                >
                  {preparing ? <LoaderCircle className="spin" size={23} /> : <Plus size={23} />}
                  <span>Add photos</span>
                </button>
              )}
            </div>
            {current && (
              <div className="photo-editor">
                <div className="photo-preview">
                  <img src={current.url} alt={`Selected trip photo ${selected + 1}`} />
                  <button
                    type="button"
                    className="remove-photo"
                    onClick={() => {
                      URL.revokeObjectURL(current.url);
                      setPhotos((p) => p.filter((_, i) => i !== selected));
                      setSelected((s) => Math.max(0, s - 1));
                    }}
                  >
                    <Trash2 size={15} /> Remove
                  </button>
                  <span className="preview-number">
                    PHOTO {String(selected + 1).padStart(2, '0')}
                  </span>
                </div>
                <div className="location-editor">
                  <div className="location-title">
                    <div>
                      <h3>
                        {current.location
                          ? current.gps
                            ? 'Location found automatically'
                            : 'Location set'
                          : current.gpsStatus === 'unreadable'
                            ? 'Couldn’t read the photo’s GPS'
                            : 'No GPS location in this photo'}
                      </h3>
                      <p>
                        {current.location
                          ? current.gps
                            ? 'The photo’s GPS placed this pin. You can publish without changing it.'
                            : 'Pin placed. You can move it with another click.'
                          : current.gpsStatus === 'unreadable'
                            ? 'Try the original camera file, search for the place, or set a pin on the map.'
                            : 'This file has no saved GPS coordinates. Search for the place below, choose a geotagged original, or place a pin.'}
                      </p>
                    </div>
                    <span className={`location-status ${current.location ? 'set' : ''}`}>
                      {current.location ? <Check size={17} /> : <MapPin size={17} />}
                    </span>
                  </div>
                  <LocationSearch
                    key={`search-${current.id}`}
                    onSelect={(place) =>
                      update({
                        location: { lat: place.lat, lng: place.lng },
                        gps: false,
                        locationFocus: place,
                      })
                    }
                  />
                  <Map
                    key={current.id}
                    value={current.location}
                    focus={current.locationFocus}
                    onChange={(location) => update({ location, gps: false })}
                    className="editor-map"
                  />
                  <CoordinateFields
                    value={current.location}
                    onChange={(location) => update({ location, gps: false })}
                  />
                  <label htmlFor="caption">
                    Caption <span>(optional)</span>
                  </label>
                  <input
                    id="caption"
                    placeholder="e.g. Kyoto, Japan"
                    maxLength={200}
                    value={current.caption}
                    onChange={(e) => update({ caption: e.target.value })}
                  />
                  <small>Friends see this after they guess.</small>
                </div>
              </div>
            )}
          </div>
        )}
        <p className="privacy-note">
          Trips are link-only, with no public directory. Anyone with the link can play and forward
          it. You can pause sharing or delete the trip from My trips. Upload only photos you have
          permission to share, and avoid sensitive locations. By creating a trip, you agree to the{' '}
          <a href="/terms" target="_blank" rel="noreferrer">
            Terms
          </a>
          . See our{' '}
          <a href="/privacy" target="_blank" rel="noreferrer">
            Privacy notice
          </a>
          .
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="publish-bar">
          <div>
            <LockKeyhole size={18} />
            <span>
              Locations stay secret until each guess.
              <br />
              <small>We remove location metadata from shared photos.</small>
            </span>
          </div>
          <button
            className="button"
            disabled={
              busy ||
              preparing ||
              !photos.length ||
              !!missing ||
              !title.trim() ||
              !hostName.trim() ||
              !usage ||
              usage.trips >= usage.limits.activeTrips
            }
          >
            {busy ? (
              <>
                <LoaderCircle className="spin" size={18} /> Publishing your trip…
              </>
            ) : (
              <>
                Create & share trip <ArrowRight size={18} />
              </>
            )}
          </button>
        </div>
        {missing > 0 && (
          <p className="missing-note">
            {missing} {missing === 1 ? 'photo has' : 'photos have'} no detected GPS location. Set{' '}
            {missing === 1 ? 'its location' : 'their locations'} or choose geotagged photos to
            publish.
          </p>
        )}
      </form>
    </main>
  );
}
