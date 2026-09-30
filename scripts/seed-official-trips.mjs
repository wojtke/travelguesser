// Dry-run validates the entire private, reviewed manifest. --apply uploads only
// approved bytes, preserves existing editions and prepares the dated schedule.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { operatorClients } from './admin-cloud.mjs';
import { CloudStore } from '../server/store.js';
import { publicData } from '../server/public-data.js';
import { assetPhoto, prepareDailies, repairFutureDailies } from '../server/public-schedule.js';
import { searchPrefixes } from '../server/public-content.js';
import { gameSettings } from '../server/game.js';
const project = process.env.PROJECT_ID,
  bucketName = process.env.PHOTO_BUCKET;
const directory = process.env.PHOTO_DIRECTORY || '.local/official-pool';
const manifest = JSON.parse(await fs.readFile(path.join(directory, 'approved.json'), 'utf8'));
const assets = manifest.assets,
  lookup = new Map(assets.map((a) => [a.id, a]));
if (assets.length < 150 || lookup.size !== assets.length)
  throw new Error('Need at least 150 distinct reviewed photos.');
let bytes = 0;
for (const a of assets) {
  if (
    !/^commons-\d+$/.test(a.id) ||
    a.key !== `${a.id}.jpg` ||
    a.status !== 'approved' ||
    a.credit?.license !== 'CC0-1.0' ||
    a.credit.licenseUrl !== 'https://creativecommons.org/publicdomain/zero/1.0/' ||
    !a.credit.author ||
    !a.credit.title ||
    new URL(a.credit.source).hostname !== 'commons.wikimedia.org' ||
    !a.review?.rightsReviewed ||
    !a.review?.locationReviewed ||
    !a.review?.method ||
    !a.reviewedAt ||
    !a.sourceEvidence?.revision ||
    !a.sourceEvidence?.wikitext ||
    !Number.isFinite(a.lat) ||
    Math.abs(a.lat) > 90 ||
    !Number.isFinite(a.lng) ||
    Math.abs(a.lng) > 180
  )
    throw new Error(`Missing review/provenance for ${a.id}`);
  const buffer = await fs.readFile(path.join(directory, a.key)),
    metadata = await sharp(buffer).metadata();
  if (
    createHash('sha256').update(buffer).digest('hex') !== a.sha256 ||
    buffer.length > 1024 * 1024 ||
    metadata.format !== 'jpeg' ||
    Math.max(metadata.width, metadata.height) > 1600 ||
    metadata.exif ||
    metadata.xmp ||
    metadata.iptc
  )
    throw new Error(`Photo validation failed for ${a.id}`);
  bytes += buffer.length;
}
for (const p of manifest.evergreen || []) {
  if (
    !/^official-[\w-]+$/.test(p.id) ||
    p.assets.length !== 5 ||
    new Set(p.assets).size !== 5 ||
    p.assets.some((id) => !lookup.has(id))
  )
    throw new Error('Invalid evergreen trip.');
}
const apply = process.argv.includes('--apply');
console.log(
  JSON.stringify({
    apply,
    photos: assets.length,
    bytes,
    evergreen: manifest.evergreen.length,
    days: 365,
  }),
);
if (!apply) process.exit(0);
if (!project || !bucketName) throw new Error('Set PROJECT_ID and PHOTO_BUCKET.');
const { db, storage } = operatorClients(project),
  bucket = storage.bucket(bucketName),
  data = publicData(new CloudStore({ db, bucket }));
try {
  for (const [i, a] of assets.entries()) {
    const key = `officialAssets/${a.id}`,
      old = await data.get(key);
    if (old && old.sha256 !== a.sha256)
      throw new Error(`Refusing to replace an existing asset: ${a.id}`);
    if (!old) {
      const file = bucket.file(`games/official-library/${a.key}`),
        [exists] = await file.exists();
      if (exists) {
        const [metadata] = await file.getMetadata();
        if (metadata.metadata?.sha256 !== a.sha256) throw new Error('Existing photo hash differs.');
      } else
        await file.save(await fs.readFile(path.join(directory, a.key)), {
          resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: 'image/jpeg',
            cacheControl: 'private, no-store',
            metadata: { sha256: a.sha256 },
          },
        });
      await data.transaction(async (t) => {
        if (!(await t.get(key))) t.set(key, a);
      });
    }
    if ((i + 1) % 25 === 0) console.log(JSON.stringify({ checkedPhotos: i + 1 }));
  }
  for (const p of manifest.evergreen)
    await data.transaction(async (t) => {
      const key = `publications/${p.id}`,
        old = await t.get(key);
      if (old) {
        if (old.photos.map((p) => p.assetId).join(',') !== p.assets.join(','))
          throw new Error(`Refusing to alter edition ${p.id}`);
        return;
      }
      t.set(key, {
        id: p.id,
        title: p.title,
        tags: p.tags,
        kind: 'official',
        hostName: 'TripGuessr',
        ownerUid: null,
        state: 'published',
        settings: gameSettings({ timeLimitSeconds: 60 }),
        createdAt: Date.now(),
        publishedAt: Date.now(),
        searchPrefixes: searchPrefixes(p.title, p.tags),
        photos: p.assets.map((id) => assetPhoto(lookup.get(id))),
      });
    });
  if (process.argv.includes('--repair-future')) console.log(await repairFutureDailies(data));
  console.log(
    await prepareDailies(data, process.env.START_DATE || new Date().toISOString().slice(0, 10)),
  );
} finally {
  await db.terminate();
}
