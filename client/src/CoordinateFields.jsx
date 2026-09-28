import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';

export default function CoordinateFields({ value, onChange }) {
  const [lat, setLat] = useState(value ? value.lat.toFixed(5) : ''),
    [lng, setLng] = useState(value ? value.lng.toFixed(5) : '');
  useEffect(() => {
    setLat(value ? value.lat.toFixed(5) : '');
    setLng(value ? value.lng.toFixed(5) : '');
  }, [value?.lat, value?.lng]);
  function apply(a, b) {
    if (
      a.trim() &&
      b.trim() &&
      Number.isFinite(Number(a)) &&
      Number.isFinite(Number(b)) &&
      Math.abs(Number(a)) <= 90 &&
      Math.abs(Number(b)) <= 180
    )
      onChange({ lat: Number(a), lng: Number(b) });
  }
  return (
    <details className="coordinates">
      <summary>
        {value ? `${value.lat.toFixed(4)}°, ${value.lng.toFixed(4)}°` : 'Or enter coordinates'}{' '}
        <ChevronRight size={13} />
      </summary>
      <div>
        <label>
          Latitude
          <input
            type="number"
            step="any"
            min="-90"
            max="90"
            placeholder="−90 to 90"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            onBlur={() => apply(lat, lng)}
          />
        </label>
        <label>
          Longitude
          <input
            type="number"
            step="any"
            min="-180"
            max="180"
            placeholder="−180 to 180"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            onBlur={() => apply(lat, lng)}
          />
        </label>
        <button type="button" className="button small outline" onClick={() => apply(lat, lng)}>
          Set pin
        </button>
      </div>
    </details>
  );
}
