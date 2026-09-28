import { useEffect, useState } from 'react';
import { MapPin, Maximize2, Minimize2 } from 'lucide-react';

// On small/touch screens the photo remains unobstructed until the map is requested.
// Keep the map mounted when hidden so panning, zoom, and the chosen pin survive.
export default function MapPanel({ children, result = false, pin = false, title, description }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (result) setExpanded(true);
  }, [result]);
  return (
    <>
      <button
        className="mobile-map-launcher button"
        aria-expanded={expanded}
        aria-controls="play-map-panel"
        onClick={() => setExpanded((v) => !v)}
      >
        <MapPin size={19} />
        {expanded
          ? 'Back to photo'
          : result
            ? 'View result map'
            : pin
              ? 'Map · pin set'
              : 'Open map'}
      </button>
      <section
        id="play-map-panel"
        className={`guess-panel panel ${expanded ? 'is-expanded' : ''} ${result ? 'showing-result' : ''}`}
        aria-label="Guess map"
        onPointerEnter={(e) => {
          if (
            e.pointerType === 'mouse' &&
            matchMedia('(min-width: 701px) and (hover: hover)').matches
          )
            setExpanded(true);
        }}
        onPointerLeave={(e) => {
          if (
            e.pointerType === 'mouse' &&
            matchMedia('(min-width: 701px) and (hover: hover)').matches &&
            !e.currentTarget.contains(document.activeElement)
          )
            setExpanded(false);
        }}
        onFocusCapture={(e) => {
          if (
            !e.target.closest('[data-map-toggle]') &&
            matchMedia('(min-width: 701px) and (hover: hover)').matches
          )
            setExpanded(true);
        }}
        onBlurCapture={(e) => {
          if (
            !e.currentTarget.contains(e.relatedTarget) &&
            matchMedia('(min-width: 701px) and (hover: hover)').matches
          )
            setExpanded(false);
        }}
      >
        <div className="guess-panel-header">
          <MapPin size={19} />
          <div>
            <h2>{title || (result ? 'Location revealed' : 'Choose a location')}</h2>
            <p>
              {description ||
                (result
                  ? 'Compare guesses with the actual location.'
                  : 'Scroll or pinch to zoom · Tap to drop a pin')}
            </p>
          </div>
          <button
            type="button"
            data-map-toggle
            aria-label={expanded ? 'Make map smaller or hide it' : 'Enlarge map'}
            aria-expanded={expanded}
            className="icon-button map-size-toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
        {children}
      </section>
    </>
  );
}
