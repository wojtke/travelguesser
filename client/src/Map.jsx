import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const icon = kind => L.divIcon({ className: 'map-marker-container', html: `<span class="map-marker ${kind}"><span></span></span>`, iconSize: [32,40], iconAnchor: [16,38] });
export default function Map({ value, onChange, actual, focus, className = '', zoom = 2 }) {
  const element = useRef(null), map = useRef(null), markers = useRef(null), change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    const m = L.map(element.current, { worldCopyJump: true, minZoom: 2, maxZoom: 18, scrollWheelZoom: true }).setView(value ? [value.lat, value.lng] : [23, 10], value ? 7 : zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>' }).addTo(m);
    const layers = L.layerGroup().addTo(m);
    m.on('click', event => {
      const lat = Math.max(-85, Math.min(85, event.latlng.lat));
      const lng = ((event.latlng.lng + 180) % 360 + 360) % 360 - 180;
      change.current?.({ lat, lng });
    });
    map.current = m; markers.current = layers;
    const observer = new ResizeObserver(() => m.invalidateSize()); observer.observe(element.current);
    return () => { observer.disconnect(); m.remove(); };
  }, []);
  useEffect(() => {
    const layers = markers.current, m = map.current;
    if (!layers || !m) return;
    layers.clearLayers();
    if (value) L.marker([value.lat, value.lng], { icon: icon('guess'), keyboard: false }).addTo(layers).bindTooltip('Your pin');
    if (actual) {
      // Use the nearest world copy when a guess crosses the date line.
      const lng = value ? actual.lng + 360 * Math.round((value.lng - actual.lng) / 360) : actual.lng;
      L.marker([actual.lat, lng], { icon: icon('actual'), keyboard: false }).addTo(layers).bindTooltip('Actual location');
      if (value) {
        L.polyline([[value.lat,value.lng],[actual.lat,lng]], { color: '#c87844', weight: 2, dashArray: '7 7' }).addTo(layers);
        m.fitBounds([[value.lat,value.lng],[actual.lat,lng]], { padding: [45,45], maxZoom: 12 });
      }
    } else if (value && !m.getBounds().contains([value.lat, value.lng])) m.panTo([value.lat, value.lng]);
  }, [value?.lat, value?.lng, actual?.lat, actual?.lng]);
  useEffect(() => {
    if (!focus || !map.current) return;
    if (focus.bounds) map.current.fitBounds(focus.bounds, { padding:[30,30], maxZoom:16 });
    else map.current.setView([focus.lat,focus.lng],14);
  }, [focus]);
  return <div className={`map ${className}`} ref={element} aria-label={actual ? 'Map showing your guess and the real location' : 'Click the map to place your pin'} />;
}
