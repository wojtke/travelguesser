import { HttpError } from './game.js';

export const LIMITS = Object.freeze({
  activeTrips: 5,
  photosPerTrip: 12,
  photoBytes: 2 * 1024 * 1024,
});
export const UPLOAD_TIMEOUT = 15 * 60 * 1000;
export function reserveTrip(creator, id, now = Date.now()) {
  const trips = { ...creator?.trips };
  if (Object.keys(trips).length >= LIMITS.activeTrips)
    throw new HttpError(
      409,
      `You can keep ${LIMITS.activeTrips} trips at a time. Delete a trip from My trips to make room.`,
    );
  trips[id] = { status: 'uploading', createdAt: now, bytes: 0 };
  return { ...creator, createdAt: creator?.createdAt || now, trips };
}
export function creatorUsage(creator) {
  const slots = Object.values(creator?.trips || {});
  return {
    trips: slots.length,
    nextTripNumber: (creator?.tripSequence ?? slots.filter((s) => s.status === 'ready').length) + 1,
    storageBytes: slots.reduce((total, slot) => total + (slot.bytes || 0), 0),
    limits: LIMITS,
  };
}
export function expiredUploads(creator, now = Date.now()) {
  return Object.entries(creator?.trips || {})
    .filter(
      ([, slot]) =>
        slot.status === 'deleting' ||
        (slot.status === 'uploading' && slot.createdAt < now - UPLOAD_TIMEOUT),
    )
    .map(([id]) => id);
}
