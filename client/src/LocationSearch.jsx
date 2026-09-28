import { useEffect, useId, useRef, useState } from 'react';
import { Search, MapPin, LoaderCircle, Check, X } from 'lucide-react';
import { api, json } from './api';

export default function LocationSearch({ onSelect }) {
  const id = useId();
  const [query, setQuery] = useState(''),
    [places, setPlaces] = useState([]);
  const [busy, setBusy] = useState(false),
    [searched, setSearched] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState('');
  const request = useRef(null),
    sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
      request.current?.abort();
    },
    [],
  );
  async function search() {
    if (query.trim().length < 2 || busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const version = ++sequence.current;
    setBusy(true);
    setError('');
    setPlaces([]);
    setSelected('');
    setSearched(false);
    try {
      const result = await api('/host/locations/search', {
        ...json('POST', { query }),
        signal: controller.signal,
      });
      if (sequence.current === version) {
        setPlaces(result.places);
        setSearched(true);
      }
    } catch (e) {
      if (sequence.current === version && e.name !== 'AbortError') setError(e.message);
    } finally {
      if (sequence.current === version) setBusy(false);
    }
  }
  function changeQuery(value) {
    sequence.current++;
    request.current?.abort();
    setQuery(value);
    setPlaces([]);
    setError('');
    setSearched(false);
    setSelected('');
    setBusy(false);
  }
  return (
    <div className="location-search">
      <label htmlFor={id}>Search for a place or address</label>
      <div className="location-search-input">
        <Search size={16} aria-hidden="true" />
        <input
          id={id}
          type="search"
          placeholder="e.g. Eiffel Tower, Paris"
          value={query}
          maxLength={160}
          autoComplete="off"
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              search();
            }
          }}
        />
        <button
          type="button"
          className="button small"
          disabled={busy || query.trim().length < 2}
          onClick={search}
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : <Search size={15} />}
          <span>{busy ? 'Searching…' : 'Search'}</span>
        </button>
      </div>
      <div aria-live="polite">
        {error && (
          <p className="search-message error" role="alert">
            {error}
          </p>
        )}
        {searched && !places.length && (
          <p className="search-message">
            No places found. Try adding a city or country, or drop a pin below.
          </p>
        )}
        {selected && (
          <p className="search-selected">
            <Check size={14} /> Pin placed at {selected}. Adjust it on the map if needed.
          </p>
        )}
      </div>
      {places.length > 0 && (
        <div className="location-results">
          <div className="location-results-heading">
            <span>Choose a place to set the photo’s location</span>
            <button
              className="icon-button"
              type="button"
              aria-label="Close search results"
              onClick={() => setPlaces([])}
            >
              <X size={14} />
            </button>
          </div>
          <ul aria-label="Matching places">
            {places.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(place);
                    setSelected(place.name);
                    setPlaces([]);
                    setSearched(false);
                  }}
                >
                  <MapPin size={17} />
                  <span>
                    <strong>{place.name}</strong>
                    {place.details && <small>{place.details}</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="search-credit">
        Place search by{' '}
        <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">
          Photon
        </a>{' '}
        · ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
      </p>
    </div>
  );
}
