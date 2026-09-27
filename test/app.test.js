import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { LocalStore } from '../server/store.js';
import { signIn, testAuthentication } from './helpers.js';
import { distanceKm, scoreGuess } from '../server/game.js';

let directory, store, app, photo;
const auth=testAuthentication();
before(async()=>{
  directory=await mkdtemp(path.join(os.tmpdir(),'travelguesser-test-'));
  store=new LocalStore(directory);
  app=createApp({store,auth,rateLimits:false});
  photo=await sharp({create:{width:100,height:80,channels:3,background:'#6688aa'}})
    .withExif({IFD0:{ImageDescription:'SPOILER: Paris'}}).jpeg().toBuffer();
});
after(async()=>{await rm(directory,{recursive:true,force:true});});

async function makeTrip() {
  const host=request.agent(app);
  await signIn(host);
  const data={title:'Test adventure',hostName:'Test host',photos:[{lat:48.8584,lng:2.2945,caption:'The reveal'},{lat:0,lng:0,caption:'At sea'}]};
  const response=await host.post('/api/games').field('metadata',JSON.stringify(data)).attach('photos',photo,'secret-location.jpg').attach('photos',photo,'another-location.jpg').expect(201);
  return {host,id:response.body.id};
}

test('geographic scoring handles exact guesses, antipodes, and the date line',()=>{
  assert.equal(distanceKm({lat:0,lng:0},{lat:0,lng:0}),0);
  assert.equal(scoreGuess(0),5000);
  assert.ok(Math.abs(distanceKm({lat:0,lng:179},{lat:0,lng:-179})-222.39)<0.1);
  assert.ok(Math.abs(distanceKm({lat:0,lng:0},{lat:0,lng:180})-20015.114)<0.1);
  assert.ok(scoreGuess(10)>scoreGuess(100));
});

test('uploading and administration require creator sign-in; cross-site writes fail',async()=>{
  await request(app).post('/api/games').expect(401);
  await request(app).get('/api/host/games').expect(401);
  await request(app).post('/api/host/session').send({key:'retired-host-key'}).expect(404);
  await request(app).post('/api/auth/session').set('Origin','https://evil.example').send({idToken:'creator-a'}).expect(403);
  await request(app).post('/api/auth/session').set('Origin','malformed').send({idToken:'creator-a'}).expect(403);
  const {id}=await makeTrip();
  await request(app).delete(`/api/games/${id}`).expect(401);
});

test('complete game hides answers, strips metadata, persists results, and scores independently',async()=>{
  const {id,host}=await makeTrip();
  const guest=request.agent(app), other=request.agent(app);
  const intro=await guest.get(`/api/games/${id}`).expect(200);
  assert.equal(intro.body.game.rounds,2);
  assert.equal(intro.body.run,null);
  assert.ok(!JSON.stringify(intro.body).includes('48.8584'));
  await guest.get(`/api/games/${id}/photos/0`).expect(403);
  await guest.post(`/api/games/${id}/join`).send({name:'Explorer'}).expect(200);
  const image=await guest.get(`/api/games/${id}/photos/0`).expect(200);
  const metadata=await sharp(image.body).metadata();
  assert.equal(metadata.exif,undefined);
  assert.equal(metadata.xmp,undefined);
  await guest.get(`/api/games/${id}/photos/1`).expect(403);
  await guest.post(`/api/games/${id}/guess`).send({round:1,lat:0,lng:0}).expect(409);
  await guest.post(`/api/games/${id}/guess`).send({round:0,lat:91,lng:0}).expect(400);
  const first=await guest.post(`/api/games/${id}/guess`).send({round:0,lat:48.8584,lng:2.2945}).expect(200);
  assert.equal(first.body.result.score,5000);
  assert.equal(first.body.result.caption,'The reveal');
  assert.equal(first.body.run.round,1);
  assert.ok(!JSON.stringify(first.body).includes('At sea'));
  const [retryA,retryB]=await Promise.all([
    guest.post(`/api/games/${id}/guess`).send({round:0,lat:-30,lng:90}),
    guest.post(`/api/games/${id}/guess`).send({round:0,lat:45,lng:90}),
  ]);
  assert.equal(retryA.body.result.score,5000);
  assert.equal(retryB.body.run.score,5000);
  const final=await guest.post(`/api/games/${id}/guess`).send({round:1,lat:0,lng:0}).expect(200);
  assert.equal(final.body.run.score,10000);
  assert.equal(final.body.run.completed,true);
  const resumed=await guest.get(`/api/games/${id}`).expect(200);
  assert.equal(resumed.body.run.results.length,2);
  await other.get(`/api/games/${id}`).expect(200);
  await other.post(`/api/games/${id}/join`).send({name:'Another friend'}).expect(200);
  const second=await other.get(`/api/games/${id}`).expect(200);
  assert.equal(second.body.run.round,0);
  const leaderboard=await guest.get(`/api/games/${id}/leaderboard`).expect(200);
  assert.deepEqual(leaderboard.body.map(e=>({name:e.name,score:e.score})),[{name:'Explorer',score:10000}]);
  const restartedStore=new LocalStore(directory);
  assert.equal((await restartedStore.getGame(id)).title,'Test adventure');
  assert.equal((await restartedStore.leaderboard(id))[0].score,10000);
  await host.delete(`/api/games/${id}`).expect(200);
  await guest.get(`/api/games/${id}`).expect(404);
  await assert.rejects(readFile(path.join(directory,'photos',id,'0.jpg')));
});

test('invalid game metadata and non-images are rejected without publishing a game',async()=>{
  const host=request.agent(app);
  await signIn(host);
  await host.post('/api/games').field('metadata','not json').attach('photos',photo,'a.jpg').expect(400);
  const meta={title:'Bad',hostName:'Host',photos:[{lat:0,lng:0}]};
  await host.post('/api/games').field('metadata',JSON.stringify(meta)).attach('photos',Buffer.from('not an image'),'a.jpg').expect(400);
  meta.photos[0].lat=null;
  await host.post('/api/games').field('metadata',JSON.stringify(meta)).attach('photos',photo,'a.jpg').expect(400);
});

test('the demo is playable and includes real photo files',async()=>{
  const guest=request.agent(app);
  await guest.get('/api/games/demo-trip').expect(200);
  await guest.post('/api/games/demo-trip/join').send({name:'Demo player'}).expect(200);
  for(let round=0;round<3;round++){
    await guest.get(`/api/games/demo-trip/photos/${round}`).expect('Content-Type',/jpeg/).expect(200);
    await guest.post('/api/games/demo-trip/guess').send({round,lat:30,lng:20}).expect(200);
  }
  const final=await guest.get('/api/games/demo-trip').expect(200);
  assert.equal(final.body.run.completed,true);
});
