import { useEffect, useRef, useState } from 'react';
import { Timer, Volume2, VolumeX } from 'lucide-react';
let audio;
export function enableCountdownAudio() {
  try {
    if (!audio && globalThis.AudioContext) audio = new AudioContext();
    audio?.resume().catch(() => {});
  } catch {
    /* Gameplay still works when the browser disables audio. */
  }
}
export default function RoundClock({
  deadline,
  serverNow,
  clockOffsetMs,
  onExpire,
  audible = true,
}) {
  const [now, setNow] = useState(Date.now()),
    [muted, setMuted] = useState(() => {
      try {
        return localStorage.getItem('tg_countdown_sound') === 'off';
      } catch {
        return false;
      }
    });
  const offset = useRef(0),
    expired = useRef(0),
    callback = useRef(onExpire),
    lastTick = useRef('');
  callback.current = onExpire;
  useEffect(() => {
    offset.current = clockOffsetMs ?? (serverNow || Date.now()) - Date.now();
    setNow(Date.now());
  }, [serverNow, clockOffsetMs]);
  useEffect(() => {
    const enable = enableCountdownAudio;
    document.addEventListener('pointerdown', enable);
    document.addEventListener('keydown', enable);
    return () => {
      document.removeEventListener('pointerdown', enable);
      document.removeEventListener('keydown', enable);
    };
  }, []);
  useEffect(() => {
    expired.current = 0;
    if (!deadline) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n + offset.current > deadline + 100 && n - expired.current > 2000) {
        expired.current = n;
        callback.current?.();
      }
    }, 100);
    return () => clearInterval(t);
  }, [deadline]);
  const seconds = deadline
    ? Math.max(0, Math.ceil((deadline - now - offset.current) / 1000))
    : null;
  useEffect(() => {
    const key = `${deadline}:${seconds}`;
    if (seconds === null || seconds < 1 || seconds > 5 || lastTick.current === key) return;
    lastTick.current = key;
    if (muted || !audible || document.hidden || audio?.state !== 'running') return;
    const oscillator = audio.createOscillator(),
      gain = audio.createGain();
    oscillator.frequency.value = 700;
    gain.gain.setValueAtTime(0.025, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.045);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.05);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }, [seconds, deadline, muted, audible]);
  if (!deadline) return null;
  return (
    <span className="countdown-group">
      <span
        className={`round-clock ${seconds <= 5 ? 'critical' : seconds <= 10 ? 'urgent' : ''}`}
        role="timer"
        aria-label={`${seconds} seconds remaining`}
      >
        <Timer size={16} />
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </span>
      <button
        type="button"
        className="countdown-mute"
        aria-label={muted ? 'Enable countdown sound' : 'Mute countdown sound'}
        aria-pressed={muted}
        onClick={() => {
          setMuted((v) => !v);
          try {
            localStorage.setItem('tg_countdown_sound', muted ? 'on' : 'off');
          } catch {}
        }}
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
    </span>
  );
}
