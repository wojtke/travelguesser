// Called before deleting the source trip, so interrupted cleanup remains retryable.
export async function deletePublishedEdition(store, id) {
  if (!id || !store.db) return;
  const ref = store.db.doc(`publications/${id}`);
  await ref.set({ state: 'deleted' }, { merge: true });
  while (true) {
    const page = await ref.collection('publicScores').limit(100).get();
    if (!page.size) break;
    const batch = store.db.batch();
    for (const row of page.docs) {
      const ownerKey = row.data().ownerKey;
      if (/^u_[a-f0-9]{64}$/.test(ownerKey || ''))
        batch.delete(store.db.doc(`publicProfiles/${ownerKey.slice(2)}/scores/${id}`));
      batch.delete(row.ref);
    }
    await batch.commit();
  }
  await store.db.recursiveDelete(ref);
}
