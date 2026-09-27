// One-time ownership migration. Dry-run by default; preserves invite URLs, photos, and runs.
// PROJECT_ID=... OWNER_EMAIL=... node scripts/migrate-trips.mjs [--apply]
import {mkdir,writeFile} from 'node:fs/promises';
import {operatorClients} from './admin-cloud.mjs';

const project=process.env.PROJECT_ID,email=process.env.OWNER_EMAIL;
if(!project||!email)throw new Error('Set PROJECT_ID and OWNER_EMAIL to the approved owner. Sign in to the app first.');
const {db,storage,auth}=operatorClients(project);
try {
  const user=await auth.getUserByEmail(email);
  if(!user.emailVerified||!user.providerData.some(p=>p.providerId==='google.com'))throw new Error('The owner must sign in with Google first.');
  const snapshots=(await db.collection('games').get()).docs.filter(d=>!d.data().ownerUid&&!d.data().demo);
  const games=[];
  const bucket=storage.bucket(process.env.PHOTO_BUCKET||`${project}-photos`);
  for(const doc of snapshots){
    const game=doc.data();let bytes=0;
    for(const photo of game.photos){const [meta]=await bucket.file(`games/${doc.id}/${photo.key}`).getMetadata();bytes+=Number(meta.size);}
    games.push({ref:doc.ref,game,bytes});
  }
  console.log(`${games.length} legacy trips found. Owner verified. ${process.argv.includes('--apply')?'Applying ownership.':'Dry run; add --apply to migrate.'}`);
  if(games.length&&process.argv.includes('--apply')){
    await mkdir('.local',{recursive:true,mode:0o700});
    await writeFile(`.local/ownership-backup-${Date.now()}.json`,JSON.stringify({project,ownerUid:user.uid,games:games.map(g=>({id:g.ref.id,...g.game}))}),{mode:0o600});
    await db.runTransaction(async t=>{
      const ownerRef=db.collection('creators').doc(user.uid);
      const owner=(await t.get(ownerRef)).data()||{createdAt:Date.now(),trips:{}};
      const current=await t.getAll(...games.map(g=>g.ref));
      for(const [i,doc] of current.entries()){
        if(doc.data()?.ownerUid)throw new Error('A trip changed ownership; rerun the migration.');
        const {game,bytes}=games[i];
        owner.trips[doc.id]={status:'ready',createdAt:game.createdAt,bytes};
        t.update(doc.ref,{ownerUid:user.uid,status:'ready',storageBytes:bytes});
      }
      t.set(ownerRef,owner);
    });
    console.log('Ownership migrated; existing links and results preserved. Backup saved privately in .local.');
  }
} finally {await db.terminate();}
