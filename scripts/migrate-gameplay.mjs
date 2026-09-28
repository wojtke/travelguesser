// Additive, repeatable migration. Default is read-only; logs contain counts only.
// PROJECT_ID=... node scripts/migrate-gameplay.mjs [--apply]
import { operatorClients } from './admin-cloud.mjs';
import { retainedRun } from '../server/demo-retention.js';
import { resultSummary, resultId } from '../server/results.js';
const project=process.env.PROJECT_ID;
if(!project)throw new Error('Set PROJECT_ID explicitly.');
const apply=process.argv.includes('--apply'),{db}=operatorClients(project);
const counts={mode:apply?'apply':'dry-run',creators:0,leaderboards:0,skippedMissingRuns:0};
try{
  const creators=await db.collection('creators').get();
  for(const doc of creators.docs){
    if(Number.isInteger(doc.data().tripSequence))continue;
    counts.creators++;
    if(apply)await db.runTransaction(async t=>{const current=(await t.get(doc.ref)).data();if(!Number.isInteger(current.tripSequence))t.update(doc.ref,{tripSequence:Object.values(current.trips||{}).filter(r=>r.status==='ready').length});});
  }
  const games=await db.collection('games').get();
  const refs=games.docs.map(d=>d.ref);
  if(!refs.some(r=>r.id==='demo-trip'))refs.push(db.doc('games/demo-trip'));
  for(const game of refs){
    const rows=await game.collection('leaderboard').get();
    for(const row of rows.docs){
      if(Array.isArray(row.data().rounds))continue;
      const ref=game.collection('runs').doc(row.id),snap=await ref.get(),run=retainedRun(game.id,snap.data());
      if(!run?.completed){counts.skippedMissingRuns++;continue;}
      counts.leaderboards++;
      if(apply)await db.runTransaction(async t=>{
        const [r,l]=await Promise.all([t.get(ref),t.get(row.ref)]),current=r.data();
        if(!current?.completed||!l.exists||Array.isArray(l.data().rounds))return;
        const publicId=current.publicId||resultId();
        t.update(ref,{publicId});t.update(row.ref,resultSummary({...current,publicId}));
      });
    }
  }
  console.log(JSON.stringify(counts));
}finally{await db.terminate();}
