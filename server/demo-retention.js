export const DEMO_ID = 'demo-trip';
export const DEMO_RETENTION_MS = 30 * 86400_000;
export function demoExpiry(record) {
  const value = record?.demoExpiresAt;
  if (value?.toMillis) return value.toMillis();
  if (value) return new Date(value).getTime();
  return (record?.startedAt ?? record?.finishedAt ?? 0) + DEMO_RETENTION_MS;
}
export function retainedRun(gameId, run, now = Date.now()) {
  return run && (gameId !== DEMO_ID || demoExpiry(run) > now) ? run : null;
}
