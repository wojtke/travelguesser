import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { api } from './api';
export default function DailyCard({ navigate }) {
  const [daily, setDaily] = useState(null),
    [error, setError] = useState('');
  useEffect(() => {
    let timer,
      stopped = false;
    const load = () =>
      api('/daily')
        .then((d) => {
          if (stopped) return;
          setDaily(d);
          timer = setTimeout(load, Math.max(1000, d.resetsAt - Date.now() + 1000));
        })
        .catch((e) => setError(e.message));
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return (
    <section className="daily-card panel">
      <div className="daily-icon">
        <CalendarDays size={32} />
      </div>
      <div>
        <span className="eyebrow">Official daily challenge</span>
        <h2>{daily?.trip ? 'Five photos. One daily challenge.' : 'Official trips'}</h2>
        <p>
          {daily?.trip
            ? `${daily.date} · 60 seconds per photo · first attempt counts`
            : error || 'Play a reviewed official trip while the next daily is prepared.'}
        </p>
        <small>A new challenge at 00:00 UTC. Guests can play for practice.</small>
      </div>
      <button
        className="button"
        onClick={() => navigate(daily?.trip ? `/p/${daily.trip.id}` : '/explore?kind=official')}
      >
        {daily?.trip ? 'Play today' : 'Browse official trips'}
      </button>
    </section>
  );
}
