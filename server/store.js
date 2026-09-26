import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { applyGuess, HttpError } from './game.js';

export function createStore({ backend = process.env.DATA_BACKEND, directory = process.env.LOCAL_DATA_DIR || '.local' } = {}) {
  if (backend === 'gcp') return new CloudStore();
  return new LocalStore(directory);
}

export class LocalStore {
  constructor(directory) { this.directory = directory; this.queue = Promise.resolve(); }
  async read() {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, 'data.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; return { games: {}, runs: {} }; }
  }
  async mutate(fn) {
    const task = this.queue.then(async () => {
      const data = await this.read();
      const result = fn(data);
      await fs.mkdir(this.directory, { recursive: true });
      const target = path.join(this.directory, 'data.json');
      await fs.writeFile(`${target}.tmp`, JSON.stringify(data));
      await fs.rename(`${target}.tmp`, target);
      return result;
    });
    this.queue = task.catch(() => {});
    return task;
  }
  async getGame(id) { return (await this.read()).games[id] || null; }
  async saveGame(game) { return this.mutate(d => { d.games[game.id] = game; return game; }); }
  async listGames() { return Object.values((await this.read()).games).filter(g => !g.demo).sort((a,b) => b.createdAt - a.createdAt).slice(0,50); }
  async join(gameId, playerId, name) {
    return this.mutate(d => {
      const key = `${gameId}:${playerId}`;
      return d.runs[key] ||= { name, score: 0, results: [], completed: false, startedAt: Date.now(), gameId };
    });
  }
  async getRun(gameId, playerId) { return (await this.read()).runs[`${gameId}:${playerId}`] || null; }
  async guess(game, playerId, input) {
    return this.mutate(d => {
      const key = `${game.id}:${playerId}`;
      if (!d.runs[key]) throw new HttpError(403, 'Join this game first.');
      const updated = applyGuess(game, d.runs[key], input);
      d.runs[key] = updated.run;
      return updated;
    });
  }
  async leaderboard(gameId) {
    return Object.values((await this.read()).runs).filter(r => r.gameId === gameId && r.completed).sort((a,b) => b.score - a.score || a.finishedAt - b.finishedAt).slice(0,20).map(({ name, score, finishedAt }) => ({ name, score, finishedAt }));
  }
  async deleteGame(id) {
    await this.mutate(d => { delete d.games[id]; for (const key of Object.keys(d.runs)) if (key.startsWith(`${id}:`)) delete d.runs[key]; });
    await fs.rm(path.join(this.directory, 'photos', id), { recursive: true, force: true });
  }
  async savePhoto(gameId, name, buffer) {
    const dir = path.join(this.directory, 'photos', gameId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), buffer);
  }
  async getPhoto(gameId, name) { return fs.readFile(path.join(this.directory, 'photos', gameId, name)); }
}

class CloudStore {
  constructor() {
    this.db = new Firestore();
    this.bucket = new Storage().bucket(process.env.PHOTO_BUCKET);
  }
  gameRef(id) { return this.db.collection('games').doc(id); }
  runRef(id, playerId) { return this.gameRef(id).collection('runs').doc(playerId); }
  async getGame(id) { const s = await this.gameRef(id).get(); return s.exists ? s.data() : null; }
  async saveGame(game) { await this.gameRef(game.id).set(game); return game; }
  async listGames() { return (await this.db.collection('games').orderBy('createdAt', 'desc').limit(51).get()).docs.map(d=>d.data()).filter(g=>!g.demo); }
  async join(gameId, playerId, name) {
    const ref = this.runRef(gameId, playerId);
    return this.db.runTransaction(async t => {
      const old = await t.get(ref);
      if (old.exists) return old.data();
      const run = { name, score: 0, results: [], completed: false, startedAt: Date.now(), gameId };
      t.create(ref, run);
      return run;
    });
  }
  async getRun(gameId, playerId) { const s = await this.runRef(gameId, playerId).get(); return s.exists ? s.data() : null; }
  async guess(game, playerId, input) {
    return this.db.runTransaction(async t => {
      const ref = this.runRef(game.id, playerId);
      const s = await t.get(ref);
      if (!s.exists) throw new HttpError(403, 'Join this game first.');
      const updated = applyGuess(game, s.data(), input);
      t.set(ref, updated.run);
      if (updated.run.completed) {
        const { name, score, finishedAt } = updated.run;
        t.set(this.gameRef(game.id).collection('leaderboard').doc(playerId), { name, score, finishedAt });
      }
      return updated;
    });
  }
  async leaderboard(gameId) { return (await this.gameRef(gameId).collection('leaderboard').orderBy('score', 'desc').limit(20).get()).docs.map(d=>d.data()); }
  async deleteGame(id) {
    // Remove access first; retries can safely clean up any remaining media.
    await this.db.recursiveDelete(this.gameRef(id));
    await this.bucket.deleteFiles({ prefix: `games/${id}/` });
  }
  async savePhoto(gameId, name, buffer) {
    await this.bucket.file(`games/${gameId}/${name}`).save(buffer, { resumable: false, contentType: 'image/jpeg', metadata: { cacheControl: 'private, max-age=3600' } });
  }
  async getPhoto(gameId, name) { const [buffer] = await this.bucket.file(`games/${gameId}/${name}`).download(); return buffer; }
}
