// Creates a temporary trip, plays it with two separate sessions, and deletes it.
// Run only against your own deployment: node scripts/smoke.mjs [base-url]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const base=(process.argv[2] || (await readFile('.local/service-url.txt','utf8')).trim()).replace(/\/$/,'');
const key=process.env.SMOKE_HOST_KEY || (await readFile('.local/host-key.txt','utf8')).trim();
const makeClient=()=>{
  const cookies=new Map();
  return async (route,{method='GET',body,raw=false,status=200}={})=>{
    const headers={ Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join(';') };
    if(body && !(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
    const response=await fetch(base+route,{method,body,headers});
    for(const cookie of response.headers.getSetCookie()){
      const pair=cookie.split(';')[0],index=pair.indexOf('=');cookies.set(pair.slice(0,index),pair.slice(index+1));
    }
    const data=raw?Buffer.from(await response.arrayBuffer()):await response.json();
    assert.equal(response.status,status,`${method} ${route}: ${JSON.stringify(raw?'binary response':data)}`);
    return data;
  };
};
const host=makeClient(), alice=makeClient(), bob=makeClient();
await host('/api/health');
await host('/api/host/session',{method:'POST',body:{key}});
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
  console.log('PASS: health, host login, photo upload/storage, metadata removal, private answers, two-player scoring, duplicate protection, leaderboard, and resume.');
} finally {
  if(id){await host(`/api/games/${id}`,{method:'DELETE'});await alice(`/api/games/${id}`,{status:404});console.log('PASS: temporary trip and photos deleted.');}
}
