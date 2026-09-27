import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const icon = kind => L.divIcon({ className: 'map-marker-container', html: `<span class="map-marker ${kind}"><span></span></span>`, iconSize: [32,40], iconAnchor: [16,38] });
export const playerColors=['#3366cc','#ae3c73','#007c78','#b25d12','#7b49b1','#537320','#b52d30','#23687d'];
export default function Map({ value, onChange, actual, guesses, focus, className = '', zoom = 2 }) {
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
    if(guesses && actual){
      const points=[[actual.lat,actual.lng]];
      L.marker(points[0],{icon:icon('actual'),keyboard:false}).addTo(layers).bindTooltip('Actual location');
      guesses.forEach((p,i)=>{
        if(!p.guess)return;
        const point=[p.guess.lat,p.guess.lng+360*Math.round((actual.lng-p.guess.lng)/360)],color=playerColors[i%playerColors.length];
        points.push(point);
        const label=document.createElement('span');label.textContent=`${i+1}. ${p.name}`;
        L.marker(point,{icon:L.divIcon({className:'player-map-marker',html:`<span style="background:${color}">${i+1}</span>`,iconSize:[28,28],iconAnchor:[14,14]}),keyboard:false}).addTo(layers).bindTooltip(label);
        L.polyline([point,points[0]],{color,weight:2,opacity:.65,dashArray:'5 7'}).addTo(layers);
      });
      m.fitBounds(points,{padding:[40,40],maxZoom:12});return;
    }
    if (value) L.marker([value.lat, value.lng], { icon: icon('guess'), keyboard: false }).addTo(layers).bindTooltip('Your pin');
    if (actual) {
      // Use the nearest world copy when a guess crosses the date line.
      const lng = value ? actual.lng + 360 * Math.round((value.lng - actual.lng) / 360) : actual.lng;
      L.marker([actual.lat, lng], { icon: icon('actual'), keyboard: false }).addTo(layers).bindTooltip('Actual location');
      if (value) {
        L.polyline([[value.lat,value.lng],[actual.lat,lng]], { color: '#c87844', weight: 2, dashArray: '7 7' }).addTo(layers);
        m.fitBounds([[value.lat,value.lng],[actual.lat,lng]], { padding: [45,45], maxZoom: 12 });
      } else m.setView([actual.lat,lng],7);
    } else if (value && !m.getBounds().contains([value.lat, value.lng])) m.panTo([value.lat, value.lng]);
  }, [value?.lat, value?.lng, actual?.lat, actual?.lng, guesses]);
  useEffect(() => {
    if (!focus || !map.current) return;
    if (focus.bounds) map.current.fitBounds(focus.bounds, { padding:[30,30], maxZoom:16 });
    else map.current.setView([focus.lat,focus.lng],14);
  }, [focus]);
  return <div className={`map ${className}`} ref={element} aria-label={actual ? 'Map showing your guess and the real location' : 'Click the map to place your pin'} />;
}
