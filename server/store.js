import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { applyGuess, beginRound, HttpError, newRun } from './game.js';
import { reserveTrip, creatorUsage, expiredUploads } from './limits.js';

const visible = game => game && (!game.status || game.status === 'ready') ? game : null;
const checkOwner = (game,uid) => { if(game && game.ownerUid !== uid) throw new HttpError(403,'This trip belongs to another creator.'); };

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
  async getGame(id) { return visible((await this.read()).games[id]); }
  async mutateGame(id, fn) { return this.mutate(d=>{const game=visible(d.games[id]);if(!game)throw new HttpError(404,'This trip is no longer available.');return d.games[id]=fn(game);}); }
  async startRound(game, playerId, round) { return this.mutate(d=>d.runs[`${game.id}:${playerId}`]=beginRound(d.runs[`${game.id}:${playerId}`],round)); }
  async cleanupUploads(uid) {
    const creator=(await this.read()).creators?.[uid];
    for(const id of expiredUploads(creator))await this.deleteGame(id,uid);
  }
  async getUsage(uid) { await this.cleanupUploads(uid); return creatorUsage((await this.read()).creators?.[uid]); }
  async beginGame(game) {
    await this.cleanupUploads(game.ownerUid);
    return this.mutate(d=>{
      d.creators ||= {};
      d.creators[game.ownerUid]=reserveTrip(d.creators[game.ownerUid],game.id);
      d.games[game.id]={...game,status:'uploading'};
    });
  }
  async publishGame(id,uid,bytes) {
    return this.mutate(d=>{
      const game=d.games[id],slot=d.creators?.[uid]?.trips[id];
      checkOwner(game,uid);
      if(!game || game.status!=='uploading'||!slot)throw new HttpError(409,'This upload expired. Please try again.');
      slot.status='ready';slot.bytes=bytes;
      Object.assign(game,{status:'ready',storageBytes:bytes});
      return game;
    });
  }
  async listGames(uid) { await this.cleanupUploads(uid); return Object.values((await this.read()).games).filter(g => visible(g)&&g.ownerUid===uid&&!g.demo).sort((a,b) => b.createdAt - a.createdAt); }
  async join(gameId, playerId, name, game) {
    return this.mutate(d => {
      if(gameId!=='demo-trip'&&!visible(d.games[gameId]))throw new HttpError(404,'This trip is no longer available.');
      const key = `${gameId}:${playerId}`;
      return d.runs[key] ||= newRun(game || d.games[gameId],name);
    });
  }
  async getRun(gameId, playerId) { return (await this.read()).runs[`${gameId}:${playerId}`] || null; }
  async guess(game, playerId, input) {
    return this.mutate(d => {
      if(game.id!=='demo-trip'&&!visible(d.games[game.id]))throw new HttpError(404,'This trip is no longer available.');
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
  async deleteGame(id,uid) {
    await this.mutate(d=>{
      checkOwner(d.games[id],uid);
      if(d.games[id])d.games[id].status='deleting';
      const slot=d.creators?.[uid]?.trips[id];
      if(slot)slot.status='deleting';
    });
    await fs.rm(path.join(this.directory, 'photos', id), { recursive: true, force: true });
    await this.mutate(d => {
      checkOwner(d.games[id],uid);
      delete d.games[id];
      if(d.creators?.[uid])delete d.creators[uid].trips[id];
      for (const key of Object.keys(d.runs)) if (key.startsWith(`${id}:`)) delete d.runs[key];
    });
  }
  async savePhoto(gameId, name, buffer) {
    const dir = path.join(this.directory, 'photos', gameId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), buffer);
  }
  async getPhoto(gameId, name) { return fs.readFile(path.join(this.directory, 'photos', gameId, name)); }
}

export class CloudStore {
  constructor({db=new Firestore(),bucket=new Storage().bucket(process.env.PHOTO_BUCKET)}={}) {
    this.db = db;
    this.bucket = bucket;
  }
  gameRef(id) { return this.db.collection('games').doc(id); }
  creatorRef(uid) { return this.db.collection('creators').doc(uid); }
  runRef(id, playerId) { return this.gameRef(id).collection('runs').doc(playerId); }
  async getGame(id) { const s = await this.gameRef(id).get(); return visible(s.data()); }
  async mutateGame(id, fn) {
    return this.db.runTransaction(async t=>{const ref=this.gameRef(id),game=visible((await t.get(ref)).data());if(!game)throw new HttpError(404,'This trip is no longer available.');const updated=fn(game);if(updated!==game)t.set(ref,updated);return updated;});
  }
  async startRound(game, playerId, round) {
    return this.db.runTransaction(async t=>{const ref=this.runRef(game.id,playerId),run=(await t.get(ref)).data(),updated=beginRound(run,round);if(updated!==run)t.set(ref,updated);return updated;});
  }
  async cleanupUploads(uid) {
    const creator=(await this.creatorRef(uid).get()).data();
    for(const id of expiredUploads(creator))await this.deleteGame(id,uid);
  }
  async getUsage(uid) { await this.cleanupUploads(uid); return creatorUsage((await this.creatorRef(uid).get()).data()); }
  async beginGame(game) {
    await this.cleanupUploads(game.ownerUid);
    await this.db.runTransaction(async t=>{
      const ref=this.creatorRef(game.ownerUid),creator=(await t.get(ref)).data();
      t.set(ref,reserveTrip(creator,game.id));
      t.create(this.gameRef(game.id),{...game,status:'uploading'});
    });
  }
  async publishGame(id,uid,bytes) {
    return this.db.runTransaction(async t=>{
      const gameRef=this.gameRef(id),creatorRef=this.creatorRef(uid);
      const [g,c]=await Promise.all([t.get(gameRef),t.get(creatorRef)]);
      const game=g.data(),creator=c.data(),slot=creator?.trips[id];
      checkOwner(game,uid);
      if(!game || game.status!=='uploading'||!slot)throw new HttpError(409,'This upload expired. Please try again.');
      slot.status='ready';slot.bytes=bytes;
      const ready={...game,status:'ready',storageBytes:bytes};
      t.set(creatorRef,creator);t.set(gameRef,ready);
      return ready;
    });
  }
  async listGames(uid) { await this.cleanupUploads(uid); return (await this.db.collection('games').where('ownerUid','==',uid).get()).docs.map(d=>d.data()).filter(g=>visible(g)&&!g.demo).sort((a,b)=>b.createdAt-a.createdAt); }
  async join(gameId, playerId, name, game) {
    const ref = this.runRef(gameId, playerId);
    return this.db.runTransaction(async t => {
      if(gameId!=='demo-trip'&&!visible((await t.get(this.gameRef(gameId))).data()))throw new HttpError(404,'This trip is no longer available.');
      const old = await t.get(ref);
      if (old.exists) return old.data();
      const run = newRun(game,name);
      t.create(ref, run);
      return run;
    });
  }
  async getRun(gameId, playerId) { const s = await this.runRef(gameId, playerId).get(); return s.exists ? s.data() : null; }
  async guess(game, playerId, input) {
    return this.db.runTransaction(async t => {
      if(game.id!=='demo-trip'&&!visible((await t.get(this.gameRef(game.id))).data()))throw new HttpError(404,'This trip is no longer available.');
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
  async deleteGame(id,uid) {
    await this.db.runTransaction(async t=>{
      const gameRef=this.gameRef(id),creatorRef=this.creatorRef(uid);
      const [g,c]=await Promise.all([t.get(gameRef),t.get(creatorRef)]);
      checkOwner(g.data(),uid);
      if(g.exists)t.update(gameRef,{status:'deleting'});
      const creator=c.data();
      if(creator?.trips[id]){creator.trips[id].status='deleting';t.set(creatorRef,creator);}
    });
    // Keep the slot until media is gone. A retry or cleanupUploads can finish interrupted deletes.
    await this.bucket.deleteFiles({ prefix: `games/${id}/` });
    await this.db.recursiveDelete(this.gameRef(id));
    await this.db.runTransaction(async t=>{
      const ref=this.creatorRef(uid),creator=(await t.get(ref)).data();
      if(creator?.trips[id]){delete creator.trips[id];t.set(ref,creator);}
    });
  }
  async savePhoto(gameId, name, buffer) {
    await this.bucket.file(`games/${gameId}/${name}`).save(buffer, { resumable: false, contentType: 'image/jpeg', metadata: { cacheControl: 'private, max-age=3600' } });
  }
  async getPhoto(gameId, name) { const [buffer] = await this.bucket.file(`games/${gameId}/${name}`).download(); return buffer; }
}
