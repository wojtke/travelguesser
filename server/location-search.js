import { setTimeout as wait } from 'node:timers/promises';
import { HttpError } from './game.js';

const validPoint = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export function normalizePlaces(data) {
  if (!Array.isArray(data?.features))
    throw new HttpError(
      502,
      'Place search is temporarily unavailable. Please try again or place a pin on the map.',
    );
  const places = [];
  const seen = new Set();
  for (const feature of data.features) {
    const p = feature.properties || {};
    const [lng, lat] = feature.geometry?.coordinates || [];
    if (feature.geometry?.type !== 'Point' || !validPoint(lat, lng)) continue;
    const name = String(
      p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || p.country || '',
    ).slice(0, 160);
    if (!name) continue;
    const details = [
      ...new Set(
        [p.street, p.housenumber, p.city, p.state, p.country].filter((v) => v && v !== name),
      ),
    ]
      .join(', ')
      .slice(0, 240);
    const id = `${p.osm_type || ''}:${p.osm_id || ''}:${lat}:${lng}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const place = { id, name, details, lat, lng };
    // Photon extents are west, north, east, south; Leaflet takes south/west, north/east.
    const extent = p.extent;
    if (Array.isArray(extent) && extent.length === 4) {
      const [west, north, east, south] = extent;
      if (validPoint(south, west) && validPoint(north, east) && south <= north && west <= east)
        place.bounds = [
          [south, west],
          [north, east],
        ];
    }
    places.push(place);
    if (places.length === 5) break;
  }
  return places;
}

export function createLocationSearch({
  fetchImpl = globalThis.fetch,
  endpoint = process.env.GEOCODING_URL || 'https://photon.komoot.io/api/',
  intervalMs = 1100,
} = {}) {
  const cache = new Map(),
    inFlight = new Map();
  let tail = Promise.resolve(),
    lastRequest = 0;
  return async (query) => {
    if (typeof query !== 'string') throw new HttpError(400, 'Enter a city, landmark, or address.');
    query = query.trim().replace(/\s+/g, ' ');
    if (query.length < 2 || query.length > 160)
      throw new HttpError(400, 'Search with between 2 and 160 characters.');
    const key = query.toLocaleLowerCase('en');
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.places;
    if (inFlight.has(key)) return inFlight.get(key);
    if (inFlight.size >= 5)
      throw new HttpError(429, 'Place search is busy. Please try again in a few seconds.');
    const request = tail.then(async () => {
      await wait(Math.max(0, intervalMs - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      try {
        const url = new URL(endpoint);
        url.searchParams.set('q', query);
        url.searchParams.set('limit', '5');
        url.searchParams.set('lang', 'en');
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(8000),
          headers: {
            Accept: 'application/json',
            'User-Agent': 'TripGuessr/1.0 (+https://github.com/wojtke/travelguesser)',
          },
        });
        if (!response.ok) throw new Error('Geocoder request failed');
        const places = normalizePlaces(await response.json());
        cache.delete(key);
        cache.set(key, { places, expires: Date.now() + 86400_000 });
        if (cache.size > 100) cache.delete(cache.keys().next().value);
        return places;
      } catch {
        throw new HttpError(
          502,
          'Place search is temporarily unavailable. Please try again or place a pin on the map.',
        );
      }
    });
    tail = request.catch(() => {});
    inFlight.set(key, request);
    try {
      return await request;
    } finally {
      inFlight.delete(key);
    }
  };
}
