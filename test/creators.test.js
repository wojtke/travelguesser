import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import request from 'supertest';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {LocalStore} from '../server/store.js';
import {validateGoogleIdentity} from '../server/auth.js';
import {UPLOAD_TIMEOUT} from '../server/limits.js';
import {testAuthentication,signIn} from './helpers.js';

let directory,store,auth,app,photo;
before(async()=>{
  directory=await mkdtemp(path.join(os.tmpdir(),'travelguesser-creators-'));
  store=new LocalStore(directory);auth=testAuthentication();app=createApp({store,auth,rateLimits:false});
  photo=await sharp({create:{width:20,height:20,channels:3,background:'red'}}).jpeg().toBuffer();
});
after(()=>rm(directory,{recursive:true,force:true}));
const upload=(agent,extra={})=>agent.post('/api/games').field('metadata',JSON.stringify({title:'Creator test',hostName:'Public nickname',photos:[{lat:1,lng:2}],...extra})).attach('photos',photo,'test.jpg');

test('Google sessions require verified Google identity and a recent sign-in',()=>{
  const valid={uid:'alice',email_verified:true,auth_time:Date.now()/1000,firebase:{sign_in_provider:'google.com'}};
  assert.equal(validateGoogleIdentity(valid),valid);
  for(const claims of [{...valid,email_verified:false},{...valid,firebase:{sign_in_provider:'password'}},{...valid,auth_time:1},{...valid,auth_time:undefined},{...valid,uid:''}])assert.throws(()=>validateGoogleIdentity(claims),{status:401});
});

test('local development sign-in cannot be enabled in production',()=>{
  const env={...process.env,NODE_ENV:'production'};
  for(const key of ['FIREBASE_API_KEY','FIREBASE_AUTH_DOMAIN','FIREBASE_APP_ID','GOOGLE_CLOUD_PROJECT'])delete env[key];
  const result=execFileSync(process.execPath,['--input-type=module','-e',"import{createAuthentication}from'./server/auth.js';try{createAuthentication();process.exit(1)}catch{console.log('closed')}"],{cwd:process.cwd(),env,encoding:'utf8'});
  assert.equal(result.trim(),'closed');
});

test('login and logout require a CSRF token; expired sessions lose creator access',async()=>{
  const agent=request.agent(app);
  await agent.get('/api/session').expect(200);
  await agent.post('/api/auth/session').send({idToken:'creator-session'}).expect(403);
  const response=await signIn(agent,'creator-session');
  assert.ok(response.headers['set-cookie'].some(cookie=>cookie.startsWith('tg_creator=')&&cookie.includes('HttpOnly')&&cookie.includes('SameSite=Lax')));
  assert.equal((await agent.get('/api/session')).body.user.uid,'creator-session');
  await agent.delete('/api/auth/session').expect(200);
  await agent.get('/api/host/games').expect(401);
  await signIn(agent,'creator-expired');auth.sessions.clear();
  await agent.get('/api/host/games').expect(401);
});

test('creators only list and delete their own trips and cannot bypass another trip’s photo progression',async()=>{
  const alice=request.agent(app),bob=request.agent(app);
  await signIn(alice,'creator-owner-a');await signIn(bob,'creator-owner-b');
  const trip=await upload(alice,{ownerUid:'creator-owner-b'}).expect(201),id=trip.body.id;
  assert.equal((await store.getGame(id)).ownerUid,'creator-owner-a');
  assert.equal((await alice.get('/api/host/games')).body.length,1);
  assert.deepEqual((await bob.get('/api/host/games')).body,[]);
  await bob.delete(`/api/games/${id}`).expect(403);
  await bob.get(`/api/games/${id}/photos/0`).expect(403);
  await alice.get(`/api/games/${id}/photos/0`).expect(200);
  const publicData=await request(app).get(`/api/games/${id}`).expect(200);
  assert.equal(publicData.body.game.hostName,'Public nickname');
  assert.ok(!JSON.stringify(publicData.body).includes('creator-owner-a'));
  await bob.post(`/api/games/${id}/join`).send({name:'Signed-in player'}).expect(200);
  await bob.get(`/api/games/${id}/photos/0`).expect(200);
  await alice.delete(`/api/games/${id}`).expect(200);
  assert.equal((await alice.get('/api/host/usage')).body.trips,0);
});

test('parallel uploads cannot exceed five slots, and deleting frees one',async()=>{
  const creator=request.agent(app);await signIn(creator,'creator-quota');
  const results=await Promise.all(Array.from({length:8},()=>upload(creator)));
  assert.equal(results.filter(r=>r.status===201).length,5);
  assert.equal(results.filter(r=>r.status===409).length,3);
  const usage=(await creator.get('/api/host/usage')).body;
  assert.equal(usage.trips,5);assert.ok(usage.storageBytes>0);
  const games=(await creator.get('/api/host/games')).body;assert.equal(games.length,5);
  await creator.delete(`/api/games/${games[0].id}`).expect(200);
  await upload(creator).expect(201);
  assert.equal((await creator.get('/api/host/usage')).body.trips,5);
});

test('failed and interrupted uploads release their reservations and remove media',async()=>{
  const creator=request.agent(app);await signIn(creator,'creator-recovery');
  await creator.post('/api/games').field('metadata',JSON.stringify({title:'Broken',hostName:'Host',photos:[{lat:0,lng:0}]})).attach('photos',Buffer.from('not an image'),'bad.jpg').expect(400);
  assert.equal((await creator.get('/api/host/usage')).body.trips,0);
  const id='stale-upload-test';
  await store.beginGame({id,ownerUid:'creator-recovery',title:'Interrupted',hostName:'Host',photos:[],createdAt:Date.now()});
  await store.savePhoto(id,'0.jpg',photo);
  assert.equal(await store.getGame(id),null);
  await store.mutate(d=>{d.creators['creator-recovery'].trips[id].createdAt=Date.now()-UPLOAD_TIMEOUT-1;});
  assert.equal((await creator.get('/api/host/usage')).body.trips,0);
  await assert.rejects(readdir(path.join(directory,'photos',id)),{code:'ENOENT'});
  assert.equal((await store.read()).games[id],undefined);
});
