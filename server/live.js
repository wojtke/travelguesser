import { randomBytes } from 'node:crypto';
import { cleanText, coordinates, distanceKm, gameSettings, HttpError, photoOrder, scoreGuess } from './game.js';

export const LIVE_LIMITS = { players:20, lifetimeHours:24, pollMs:3000 };
export function newLive(game, input={}, now=Date.now()) {
  if(game.live && game.live.phase!=='finished' && game.live.expiresAt>now)return game;
  const settings=gameSettings({...game.settings,...input,mode:'live'});
  return {...game,live:{id:randomBytes(16).toString('base64url'),revision:0,phase:'lobby',createdAt:now,expiresAt:now+24*3600_000,
    settings,order:photoOrder(game,settings.shufflePhotos),round:0,deadline:null,players:{}}};
}
export function getLive(game, id, now=Date.now()) {
  if(!game.live || game.live.id!==id)throw new HttpError(404,'This lobby no longer exists. Ask the host for a new link.');
  if(game.live.expiresAt<=now)throw new HttpError(410,'This live session expired. The host can open a new lobby.');
  return game.live;
}
function finishRound(game, live) {
  const photo=game.photos[live.order[live.round]], actual={lat:photo.lat,lng:photo.lng};
  const players=Object.fromEntries(Object.entries(live.players).map(([id,p])=>{
    if(!live.roster.includes(id))return [id,p];
    const guess=p.guess, distance=guess?distanceKm(guess,actual):null, score=guess?scoreGuess(distance):0;
    return [id,{...p,score:p.score+score,results:[...p.results,{round:live.round,guess,distance,score,actual,caption:photo.caption||''}]}];
  }));
  return {...live,phase:'results',players};
}
export function expireLive(game, now=Date.now()) {
  const live=game.live;
  if(live?.phase==='round' && live.deadline && now>=live.deadline)return {...game,live:{...finishRound(game,live),revision:(live.revision||0)+1}};
  return game;
}
export function updateLive(game, id, actor, action, input={}, now=Date.now()) {
  getLive(game,id,now);
  game=expireLive(game,now);
  let live=game.live;
  const host=!!actor.uid && actor.uid===game.ownerUid;
  const requireHost=()=>{if(!host)throw new HttpError(403,'Only the trip creator can control this lobby.');};
  if(action==='join') {
    const name=cleanText(input.name,24,'Your name');
    if(live.players[actor.playerId])return game;
    if(live.phase!=='lobby')throw new HttpError(409,'The game has started. Ask the host to open a new lobby when it finishes.');
    if(Object.keys(live.players).length>=LIVE_LIMITS.players)throw new HttpError(409,`This lobby is full (${LIVE_LIMITS.players} players).`);
    if(Object.values(live.players).some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw new HttpError(409,'That name is already in the lobby. Choose another nickname.');
    live={...live,players:{...live.players,[actor.playerId]:{id:randomBytes(9).toString('base64url'),name,score:0,results:[],guess:null,active:true}}};
  } else if(action==='start' || action==='next') {
    requireHost();
    // A retry with the previous phase/round cannot advance two rounds.
    if(input.round!==live.round || (action==='start'?live.phase!=='lobby':live.phase!=='results'))return game;
    const round=action==='start'?0:live.round+1;
    if(round>=game.photos.length)live={...live,phase:'finished'};
    else {
      const roster=Object.entries(live.players).filter(([,p])=>p.active).map(([id])=>id);
      if(!roster.length)throw new HttpError(409,'At least one player must join before starting a round.');
      live={...live,round,roster,phase:'round',startedAt:now,deadline:live.settings.timeLimitSeconds?now+live.settings.timeLimitSeconds*1000:null,
        players:Object.fromEntries(Object.entries(live.players).map(([id,p])=>[id,{...p,guess:null}]))};
    }
  } else if(action==='guess') {
    const p=live.players[actor.playerId];
    if(!p?.active)throw new HttpError(403,'Join this lobby first.');
    if(live.phase!=='round' || input.round!==live.round || p.guess)return game;
    live={...live,players:{...live.players,[actor.playerId]:{...p,guess:coordinates(input)}}};
    if(live.roster.every(id=>live.players[id].guess || !live.players[id].active))live=finishRound(game,live);
  } else if(action==='remove' || action==='leave') {
    if(action==='remove')requireHost();
    const key=action==='leave'?actor.playerId:Object.keys(live.players).find(id=>live.players[id].id===input.playerId);
    if(!key || !live.players[key])return game;
    const players={...live.players};
    if(live.phase==='lobby')delete players[key];else players[key]={...players[key],active:false};
    live={...live,players};
    if(live.phase==='round' && live.roster.every(id=>live.players[id].guess || !live.players[id].active))live=finishRound(game,live);
  } else if(action==='reveal') {
    requireHost();
    if(input.round===live.round && live.phase==='round')live=finishRound(game,live);
  } else if(action==='end') {
    requireHost();
    if(live.phase==='round')live=finishRound(game,live);
    live={...live,phase:'finished'};
  } else throw new HttpError(400,'Unknown lobby action.');
  return live===game.live ? game : {...game,live:{...live,revision:(live.revision||0)+1}};
}
export function publicLive(game, actor, now=Date.now()) {
  const l=game.live, me=l.players[actor.playerId], isHost=!!actor.uid && actor.uid===game.ownerUid;
  const joined=!!me || isHost, revealed=joined && ['results','finished'].includes(l.phase);
  return {id:l.id,revision:l.revision||0,gameId:game.id,title:game.title,hostName:game.hostName,phase:l.phase,round:l.round,rounds:game.photos.length,
    settings:l.settings,deadline:l.deadline,expiresAt:l.expiresAt,serverNow:now,isHost,joined:!!me,me:me?{id:me.id,name:me.name,active:me.active,guess:me.guess,score:me.score}:null,
    playerCount:Object.keys(l.players).length,limits:LIVE_LIMITS,
    players:joined?Object.values(l.players).map(p=>({id:p.id,name:p.name,active:p.active,score:p.score,submitted:!!p.guess})):[],
    results:revealed?Object.values(l.players).filter(p=>p.results[l.round]).map(p=>({id:p.id,name:p.name,total:p.score,...p.results[l.round]})).sort((a,b)=>b.score-a.score):[],
    photoUrl:joined && l.phase!=='lobby'?`/api/games/${game.id}/live/${l.id}/photos/${l.round}`:null};
}
