// Creates a temporary trip, plays it with two separate sessions, and deletes it.
// Defaults to anonymous demo verification. --create also checks a disposable upload.
// For --create on Google-auth deployments, supply a fresh Firebase Google ID token
// in SMOKE_ID_TOKEN_FILE (keep it outside Git); local development needs no token.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const base=(process.argv.slice(2).find(arg=>!arg.startsWith('--')) || (await readFile('.local/service-url.txt','utf8')).trim()).replace(/\/$/,'');
const create=process.argv.includes('--create');
const makeClient=()=>{
  const cookies=new Map();let csrf;
  return async (route,{method='GET',body,raw=false,status=200}={})=>{
    const headers={ Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join(';') };
    if(csrf)headers['X-CSRF-Token']=csrf;
    if(body && !(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
    const response=await fetch(base+route,{method,body,headers});
    for(const cookie of response.headers.getSetCookie()){
      const pair=cookie.split(';')[0],index=pair.indexOf('=');cookies.set(pair.slice(0,index),pair.slice(index+1));
    }
    const data=raw?Buffer.from(await response.arrayBuffer()):await response.json();
    if(data.csrfToken)csrf=data.csrfToken;
    assert.equal(response.status,status,`${method} ${route}: ${JSON.stringify(raw?'binary response':data)}`);
    return data;
  };
};
const host=makeClient(), alice=makeClient(), bob=makeClient();
await host('/api/health');
const session=await host('/api/session');
assert.equal(session.user,null);
await host('/api/host/games',{status:401});
if(create){
  const idToken=session.auth.provider==='local'?'local-development':process.env.SMOKE_ID_TOKEN_FILE?(await readFile(process.env.SMOKE_ID_TOKEN_FILE,'utf8')).trim():null;
  assert.ok(idToken,'Set SMOKE_ID_TOKEN_FILE to a fresh Google ID token for --create.');
  await host('/api/auth/session',{method:'POST',body:{idToken}});
} else {
  await alice('/api/games/demo-trip/join',{method:'POST',body:{name:'Deployment check'}});
  for(const [round,point] of [{lat:48.8584,lng:2.2945},{lat:-33.8568,lng:151.2153},{lat:37.8199,lng:-122.4783}].entries()){
    assert.ok((await alice(`/api/games/demo-trip/photos/${round}`,{raw:true})).length>100);
    const guess=await alice('/api/games/demo-trip/guess',{method:'POST',body:{...point,round}});
    assert.equal(guess.result.score,5000);
  }
  assert.equal((await alice('/api/games/demo-trip')).run.completed,true);
  console.log('PASS: public health, creator authentication required, anonymous demo photos, scoring, and resume.');
  process.exit(0);
}
let id;
try {
  const image=await sharp({create:{width:400,height:300,channels:3,background:'#739068'}}).withExif({IFD0:{ImageDescription:'private test metadata'}}).jpeg().toBuffer();
  const form=new FormData();
  form.append('metadata',JSON.stringify({title:'Deployment verification (temporary)',hostName:'System check',photos:[{lat:52.2297,lng:21.0122,caption:'Warsaw test location'}]}));
  form.append('photos',new Blob([image],{type:'image/jpeg'}),'private-name.jpg');
  const game=await host('/api/games',{method:'POST',body:form,status:201});id=game.id;
  const intro=await alice(`/api/games/${id}`);
  assert.equal(intro.run,null);assert.equal(JSON.stringify(intro).includes('52.2297'),false);
  await alice(`/api/games/${id}/join`,{method:'POST',body:{name:'Test Alice'}});
  const published=await alice(`/api/games/${id}/photos/0`,{raw:true});
  assert.equal((await sharp(published).metadata()).exif,undefined);
  const result=await alice(`/api/games/${id}/guess`,{method:'POST',body:{lat:52.2297,lng:21.0122,round:0}});
  assert.equal(result.run.score,5000);assert.equal(result.run.completed,true);
  const duplicate=await alice(`/api/games/${id}/guess`,{method:'POST',body:{lat:0,lng:0,round:0}});
  assert.equal(duplicate.run.score,5000);
  await bob(`/api/games/${id}`);
  await bob(`/api/games/${id}/join`,{method:'POST',body:{name:'Test Bob'}});
  const second=await bob(`/api/games/${id}/guess`,{method:'POST',body:{lat:50,lng:20,round:0}});
  assert.ok(second.run.score<5000);
  const board=await bob(`/api/games/${id}/leaderboard`);
  assert.equal(board.length,2);assert.equal(board[0].name,'Test Alice');
  const resume=await alice(`/api/games/${id}`);assert.equal(resume.run.score,5000);
  console.log('PASS: health, creator login, photo upload/storage, metadata removal, private answers, two-player scoring, duplicate protection, leaderboard, and resume.');
} finally {
  if(id){await host(`/api/games/${id}`,{method:'DELETE'});await alice(`/api/games/${id}`,{status:404});console.log('PASS: temporary trip and photos deleted.');}
}
