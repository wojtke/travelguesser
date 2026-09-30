import { HttpError, tripSnapshot } from './game.js';
import { LIMITS, UPLOAD_TIMEOUT } from './limits.js';

export const TRIP_STORAGE_BYTES = LIMITS.photosPerTrip * LIMITS.photoBytes;

export function checkEditVersion(game, version) {
  if (!Number.isInteger(version) || version !== (game.tripRevision || 0))
    throw new HttpError(
      409,
      'This trip changed in another window. Reload the editor before saving.',
    );
}

export async function reserveTripEdit(store, id, uid, version, upload) {
  return store.mutateOwnedGame(id, uid, (g) => {
    checkEditVersion(g, version);
    if (g.editUpload)
      throw new HttpError(409, 'Another save is in progress. Please try again shortly.');
    if ((g.storageBytes || 0) + upload.bytes > TRIP_STORAGE_BYTES)
      throw new HttpError(
        409,
        'This trip has reached its 24 MB photo limit, including photos kept for earlier games. You can still edit its details and locations. Create another trip to upload more photos.',
      );
    return { ...g, editUpload: upload, storageBytes: (g.storageBytes || 0) + upload.bytes };
  });
}

export async function commitTripEdit(store, id, uid, version, token, changes) {
  return store.mutateOwnedGame(id, uid, (g) => {
    checkEditVersion(g, version);
    if (g.editUpload?.token !== token || g.editUpload?.discarding)
      throw new HttpError(409, 'This save expired. Please try again.');
    const { editUpload, ...game } = g;
    return {
      ...game,
      originalTrip: g.originalTrip || tripSnapshot(g),
      ...changes,
      tripRevision: version + 1,
      updatedAt: Date.now(),
    };
  });
}

export async function discardTripEdit(store, id, uid, upload) {
  let current;
  try {
    current = await store.mutateOwnedGame(id, uid, (g) =>
      g.editUpload?.token === upload.token
        ? { ...g, editUpload: { ...g.editUpload, discarding: true } }
        : g,
    );
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (current && current.editUpload?.token !== upload.token) return current;
  // Delete only this upload's random keys, never media referenced by a saved trip.
  for (const key of upload.keys) await store.deletePhoto(id, key);
  if (!current) return null;
  return store.mutateOwnedGame(id, uid, (g) => {
    if (g.editUpload?.token !== upload.token) return g;
    const { editUpload, ...game } = g;
    return { ...game, storageBytes: Math.max(0, (g.storageBytes || 0) - upload.bytes) };
  });
}

export async function recoverTripEdit(store, game, uid) {
  if (game.editUpload && game.editUpload.createdAt < Date.now() - UPLOAD_TIMEOUT)
    return discardTripEdit(store, game.id, uid, game.editUpload);
  return game;
}
