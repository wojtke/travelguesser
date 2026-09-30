// Additive only: create missing indexes and apply the checked-in field/TTL settings.
// Uses the operator login. No application data or existing indexes are deleted.
import fs from 'node:fs/promises';
import { accessToken } from './admin-cloud.mjs';
const project = process.env.PROJECT_ID;
if (!project || !/^[a-z][a-z0-9-]+$/.test(project)) throw new Error('Set PROJECT_ID.');
const config = JSON.parse(await fs.readFile('firestore.indexes.json', 'utf8'));
if (!process.argv.includes('--apply')) {
  console.log(
    JSON.stringify({
      indexes: config.indexes.length,
      fields: config.fieldOverrides.length,
      apply: false,
    }),
  );
  process.exit(0);
}
const token = accessToken(),
  base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups`;
const api = async (url, method = 'GET', body) => {
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': project,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(`Firestore configuration failed (${r.status}): ${data.error?.message}`);
  return data;
};
const operations = [];
for (const group of new Set(config.indexes.map((i) => i.collectionGroup))) {
  const existing = (await api(`${base}/${group}/indexes`)).indexes || [];
  for (const { collectionGroup, ...index } of config.indexes.filter(
    (i) => i.collectionGroup === group,
  )) {
    if (
      existing.some(
        (e) =>
          e.queryScope === index.queryScope &&
          JSON.stringify(e.fields) === JSON.stringify(index.fields),
      )
    )
      continue;
    const op = await api(`${base}/${group}/indexes`, 'POST', index);
    operations.push(op.name);
  }
}
for (const field of config.fieldOverrides) {
  const url = `${base}/${field.collectionGroup}/fields/${field.fieldPath}`;
  const current = await api(url),
    indexConfig = { indexes: field.indexes };
  const body = { indexConfig },
    mask = ['indexConfig'];
  if (field.ttl) {
    body.ttlConfig = {};
    mask.push('ttlConfig');
  }
  if (
    (current.indexConfig?.indexes?.length || 0) === 0 &&
    !current.indexConfig?.usesAncestorConfig &&
    (!field.ttl || current.ttlConfig?.state === 'ACTIVE')
  )
    continue;
  const op = await api(`${url}?updateMask=${mask.join(',')}`, 'PATCH', body);
  if (op.name) operations.push(op.name);
}
console.log(JSON.stringify({ requestedOperations: operations.length, operations }));
