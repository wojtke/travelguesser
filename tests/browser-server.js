import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { LocalStore } from '../server/store.js';
import { newLive } from '../server/live.js';
const directory = await mkdtemp(path.join(os.tmpdir(), 'tripguessr-browser-'));
const store = new LocalStore(directory);
const photo = await sharp({
  create: { width: 900, height: 600, channels: 3, background: '#406080' },
})
  .jpeg()
  .toBuffer();
for (const [id, mode] of [
  ['timed-browser-trip', 'solo'],
  ['live-browser-trip', 'live'],
]) {
  const game = {
    id,
    ownerUid: 'local-developer',
    title: id,
    hostName: 'Host',
    createdAt: Date.now(),
    settings: { mode, timeLimitSeconds: mode === 'solo' ? 15 : 0, shufflePhotos: false },
    photos: [
      { key: '0.jpg', lat: 0, lng: 0 },
      { key: '1.jpg', lat: 0, lng: 0 },
    ],
  };
  await store.beginGame(game);
  await store.savePhoto(id, '0.jpg', photo);
  await store.savePhoto(id, '1.jpg', photo);
  await store.publishGame(id, game.ownerUid, photo.length * 2);
  if (mode === 'live') await store.mutateGame(id, (g) => newLive(g));
}
const server = createApp({ store, rateLimits: false }).listen(4179, '127.0.0.1');
async function close() {
  server.close();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
