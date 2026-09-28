import { useCallback, useEffect, useRef, useState } from 'react';
import { api, json } from './api';
export default function useLiveSession(id, liveId) {
  const base = `/games/${id}/live/${liveId}`;
  const [live, setLive] = useState(null),
    [error, setError] = useState(''),
    [fatal, setFatal] = useState(''),
    [busy, setBusy] = useState(false),
    [pin, setPin] = useState(null),
    [saveStatus, setSaveStatus] = useState(''),
    [retry, setRetry] = useState(0);
  const mounted = useRef(true),
    connected = useRef(false),
    working = useRef(false),
    pinRef = useRef(null),
    sequence = useRef(0),
    lastSave = useRef(0),
    roundRef = useRef(null),
    latest = useRef(null),
    acceptedRevision = useRef(-1),
    fatalRef = useRef('');
  fatalRef.current = fatal;
  latest.current = live;
  const accept = useCallback((data) => {
    if (!mounted.current || data.revision < acceptedRevision.current) return;
    acceptedRevision.current = data.revision;
    if (roundRef.current !== data.round) {
      roundRef.current = data.round;
      sequence.current = 0;
      pinRef.current = null;
      setPin(null);
      setSaveStatus('');
    }
    if (data.draft?.round === data.round && !pinRef.current) {
      sequence.current = data.draft.version;
      pinRef.current = data.draft.point;
      setPin(data.draft.point);
      setSaveStatus('Saved');
    }
    setLive((old) =>
      !old || data.revision >= old.revision || data.isHost !== old.isHost
        ? { ...data, clockOffsetMs: data.clockOffsetMs ?? old?.clockOffsetMs ?? 0 }
        : old,
    );
    setError('');
  }, []);
  const refresh = useCallback(async () => {
    try {
      accept(await api(base));
    } catch (e) {
      if (mounted.current) {
        setError(e.message);
        if ([403, 404, 410].includes(e.status)) setFatal('Lobby unavailable');
      }
    }
  }, [base, accept]);
  useEffect(() => {
    mounted.current = true;
    refresh();
    const timer = setInterval(() => {
      if (
        !document.hidden &&
        !connected.current &&
        !fatalRef.current &&
        latest.current?.phase !== 'finished'
      )
        refresh();
    }, 3000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  const eligible =
    !!(live?.joined || live?.isHost) &&
    live?.protocolVersion === 2 &&
    live?.phase !== 'finished' &&
    !fatal;
  useEffect(() => {
    if (!eligible) return;
    let source;
    const open = () => {
      source?.close();
      connected.current = false;
      if (document.hidden) return;
      source = new EventSource(`/api${base}/events`);
      source.onopen = () => {
        connected.current = true;
      };
      source.onmessage = (e) => {
        try {
          accept(JSON.parse(e.data));
        } catch {
          setError('Could not read a live update. Reconnecting…');
          source.close();
          connected.current = false;
          refresh();
        }
      };
      source.onerror = () => {
        connected.current = false;
      };
      source.addEventListener('unavailable', (e) => {
        source.close();
        connected.current = false;
        const reason = JSON.parse(e.data).reason;
        setFatal(reason === 'removed' ? 'You are no longer in this lobby' : 'Lobby unavailable');
      });
    };
    open();
    const visibility = () => {
      open();
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      source?.close();
      connected.current = false;
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [eligible, base, accept, refresh]);
  const changePin = useCallback((point) => {
    pinRef.current = point;
    setPin(point);
    setSaveStatus('Saving…');
  }, []);
  useEffect(() => {
    if (
      !pin ||
      live?.protocolVersion !== 2 ||
      live?.me?.guess ||
      !live?.me?.active ||
      !['preparing', 'round'].includes(live?.phase)
    )
      return;
    const version = ++sequence.current,
      round = live.round;
    const timer = setTimeout(
      async () => {
        lastSave.current = Date.now();
        try {
          const saved = await api(`${base}/draft`, json('POST', { ...pin, round, version }));
          if (mounted.current && roundRef.current === round && sequence.current === version) {
            sequence.current = Math.max(version, saved.version);
            setSaveStatus(
              saved.point.lat === pin.lat && saved.point.lng === pin.lng
                ? 'Saved'
                : 'Couldn’t save',
            );
          }
        } catch (e) {
          if (
            mounted.current &&
            roundRef.current === round &&
            sequence.current === version &&
            !latest.current?.me?.guess &&
            latest.current?.phase !== 'results'
          )
            setSaveStatus('Couldn’t save');
        }
      },
      Math.max(0, 500 - (Date.now() - lastSave.current)),
    );
    return () => clearTimeout(timer);
  }, [pin, retry, live?.round, live?.protocolVersion, live?.me?.guess, live?.me?.active, base]);
  async function action(type, body = {}) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      accept(await api(`${base}/${type}`, json('POST', { round: latest.current?.round, ...body })));
    } catch (e) {
      setError(e.message);
      if ([403, 404, 410].includes(e.status)) refresh();
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const ready = useCallback(
    (round) => {
      api(`${base}/ready`, json('POST', { round }))
        .then(accept)
        .catch(() => {});
    },
    [base, accept],
  );
  return {
    live,
    error,
    fatal,
    busy,
    pin,
    setPin: changePin,
    saveStatus,
    retrySave: () => setRetry((v) => v + 1),
    action,
    refresh,
    ready,
  };
}
