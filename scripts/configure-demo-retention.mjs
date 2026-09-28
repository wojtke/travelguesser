// Dry-run first. Only demo progress/scores receive expiry; user trips are untouched.
import { operatorClients } from './admin-cloud.mjs';
import { demoExpiry } from '../server/demo-retention.js';
const project = process.env.PROJECT_ID;
if (!project) throw new Error('Set PROJECT_ID.');
const apply = process.argv.includes('--apply');
const { db } = operatorClients(project);
let scanned = 0,
  changed = 0;
try {
  for (const collection of ['runs', 'leaderboard']) {
    const query = db.doc('games/demo-trip').collection(collection).orderBy('__name__');
    let cursor;
    do {
      const page = await (cursor ? query.startAfter(cursor) : query).limit(200).get();
      for (const doc of page.docs) {
        scanned++;
        if (doc.data().demoExpiresAt) continue;
        changed++;
        if (apply)
          await db.runTransaction(async (t) => {
            const current = await t.get(doc.ref);
            if (current.exists && !current.data().demoExpiresAt)
              t.update(doc.ref, { demoExpiresAt: new Date(demoExpiry(current.data())) });
          });
      }
      cursor = page.size === 200 ? page.docs.at(-1) : null;
    } while (cursor);
  }
  console.log(JSON.stringify({ apply, scanned, expiryFields: changed }));
} finally {
  await db.terminate();
}
