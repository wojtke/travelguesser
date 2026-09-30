// The same transactional interface is used by the local app and Firestore.
// Writes are staged until all reads finish (Firestore forbids read-after-write).
export function publicData(store) {
  const ref = (key) => store.db.doc(key);
  const match = (value, filters) =>
    filters.every(([field, op, wanted]) => {
      const got = value[field];
      return op === '=='
        ? got === wanted
        : op === '<='
          ? got <= wanted
          : op === '>='
            ? got >= wanted
            : op === 'array-contains'
              ? got?.includes(wanted)
              : false;
    });
  return {
    async get(key) {
      if (store.db) return (await ref(key).get()).data() || null;
      const local = await store.read();
      return key.startsWith('games/') && key.split('/').length === 2
        ? local.games[key.split('/')[1]] || null
        : local.publicData?.[key] || null;
    },
    async transaction(fn) {
      const execute = async (read, query, commit) => {
        const writes = new Map();
        const tx = {
          get: async (key) => (writes.has(key) ? writes.get(key) : read(key)),
          query,
          set: (key, value) => writes.set(key, value),
          delete: (key) => writes.set(key, null),
        };
        const result = await fn(tx);
        await commit(writes);
        return result;
      };
      if (store.db)
        return store.db.runTransaction(async (t) =>
          execute(
            async (key) => (await t.get(ref(key))).data() || null,
            async (collection, filters = [], limit = 20) => {
              let q = store.db.collection(collection);
              for (const [f, op, v] of filters) q = q.where(f, op, v);
              return (await t.get(q.limit(limit))).docs.map((d) => d.data());
            },
            async (writes) => {
              for (const [key, value] of writes)
                value === null ? t.delete(ref(key)) : t.set(ref(key), value);
            },
          ),
        );
      // LocalStore.mutate accepts async callbacks as well as synchronous legacy ones.
      return store.mutate(async (data) => {
        data.publicData ||= {};
        const read = async (key) =>
          key.startsWith('games/') && key.split('/').length === 2
            ? data.games[key.split('/')[1]] || null
            : data.publicData[key] || null;
        return execute(
          read,
          async (collection, filters = [], limit = 20) =>
            Object.entries(data.publicData)
              .filter(
                ([k, v]) =>
                  k.startsWith(`${collection}/`) &&
                  k.split('/').length === collection.split('/').length + 1 &&
                  match(v, filters),
              )
              .slice(0, limit)
              .map(([, v]) => v),
          async (writes) => {
            for (const [key, value] of writes) {
              if (key.startsWith('games/') && key.split('/').length === 2) {
                if (value === null) delete data.games[key.split('/')[1]];
                else data.games[key.split('/')[1]] = value;
              } else if (value === null) delete data.publicData[key];
              else data.publicData[key] = value;
            }
          },
        );
      });
    },
    async list(
      collection,
      { filters = [], order = 'createdAt', direction = 'desc', cursor, limit = 20 } = {},
    ) {
      if (store.db) {
        let q = store.db.collection(collection);
        for (const [f, op, v] of filters) q = q.where(f, op, v);
        q = q.orderBy(order, direction).orderBy('__name__', direction);
        if (cursor) q = q.startAfter(cursor.value, ref(`${collection}/${cursor.id}`));
        return (await q.limit(limit).get()).docs.map((d) => d.data());
      }
      const sign = direction === 'asc' ? 1 : -1;
      const compare = (a, b) =>
        sign *
        ((a[order] < b[order] ? -1 : a[order] > b[order] ? 1 : 0) || a.id.localeCompare(b.id));
      return Object.entries((await store.read()).publicData || {})
        .filter(
          ([k, v]) =>
            k.startsWith(`${collection}/`) &&
            k.split('/').length === collection.split('/').length + 1 &&
            match(v, filters),
        )
        .map(([, v]) => v)
        .filter((v) => !cursor || compare(v, { id: cursor.id, [order]: cursor.value }) > 0)
        .sort(compare)
        .slice(0, limit);
    },
    watch(key, onData, onError) {
      if (store.db) return ref(key).onSnapshot((s) => onData(s.data() || null), onError);
      // Initialize the emitter through the existing shared local watcher.
      const stop = store.watchGame(
        '__public_watch__',
        () => {
          this.get(key).then(onData).catch(onError);
        },
        onError,
      );
      return stop;
    },
  };
}
