// Operator-only acquisition. Downloads candidates; it never approves or publishes them.
// Provenance, coordinates and photo bytes stay in the gitignored .local directory.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const directory = '.local/official-pool';
await fs.mkdir(directory, { recursive: true });
const agent =
  'TripGuessr/1.0 (https://github.com/wojtke/travelguesser; operator-reviewed CC0 photo curation)';
const pause = () => new Promise((r) => setTimeout(r, 1200));
const text = (v) =>
  String(v || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const regions = [
  ['Japan', 24, 46, 123, 146],
  ['Iceland', 63, 67, -25, -12],
  ['Norway', 58, 72, 4, 32],
  ['Switzerland', 45, 48, 5, 11],
  ['New Zealand', -48, -33, 165, 179],
  ['Australia', -44, -10, 112, 155],
  ['Canada', 42, 74, -141, -52],
  ['United States', 24, 50, -125, -66],
  ['Portugal', 36, 43, -10, -6],
  ['Spain', 35, 44, -10, 5],
  ['France', 42, 51, -5, 9],
  ['Germany', 47, 55, 5, 15],
  ['Poland', 49, 55, 14, 24],
  ['Czech Republic', 48, 51, 12, 19],
  ['Austria', 46, 49, 9, 18],
  ['Slovenia', 45, 47, 13, 17],
  ['Croatia', 42, 47, 13, 20],
  ['Greece', 34, 42, 19, 29],
  ['Italy', 36, 47, 6, 19],
  ['Ireland', 51, 56, -11, -5],
  ['Scotland', 54, 61, -9, 0],
  ['England', 50, 56, -6, 2],
  ['Sweden', 55, 70, 10, 25],
  ['Finland', 59, 71, 19, 32],
  ['Denmark', 54, 58, 8, 16],
  ['Netherlands', 50, 54, 3, 8],
  ['Belgium', 49, 52, 2, 7],
  ['Romania', 43, 49, 20, 30],
  ['Bulgaria', 41, 45, 22, 29],
  ['Turkey', 35, 43, 25, 45],
  ['Morocco', 27, 36, -14, -1],
  ['Tunisia', 30, 38, 7, 12],
  ['South Africa', -35, -22, 16, 33],
  ['Namibia', -29, -16, 11, 26],
  ['Kenya', -5, 5, 33, 42],
  ['Tanzania', -12, 0, 29, 41],
  ['Brazil', -34, 6, -74, -34],
  ['Argentina', -56, -21, -74, -53],
  ['Chile', -56, -17, -76, -66],
  ['Peru', -19, 1, -82, -68],
  ['Mexico', 14, 33, -118, -86],
  ['Costa Rica', 8, 12, -86, -82],
  ['India', 6, 37, 68, 98],
  ['Nepal', 26, 31, 80, 89],
  ['Thailand', 5, 21, 97, 106],
  ['Vietnam', 8, 24, 102, 110],
  ['Indonesia', -11, 6, 94, 142],
  ['Malaysia', 0, 8, 99, 120],
  ['China', 18, 54, 73, 135],
  ['Taiwan', 21, 26, 119, 123],
  ['South Korea', 33, 39, 125, 130],
  ['Mongolia', 41, 53, 87, 120],
  ['Georgia', 41, 44, 40, 47],
  ['Armenia', 38, 42, 43, 47],
  ['Jordan', 29, 34, 34, 40],
  ['Israel', 29, 34, 34, 36],
];
const manifestPath = path.join(directory, 'candidates.json');
let records = JSON.parse(await fs.readFile(manifestPath, 'utf8').catch(() => '[]'));
const ids = new Set(records.map((r) => r.id));
const limit = Number(process.env.CANDIDATE_LIMIT || 360);
const reject =
  /AI-generated|Midjourney|Stable Diffusion|computer.generated|rendering|painting|portrait|sculpture|statue|manuscript|logo|poster|interior|airbnb|craft|excavator|heater|school|workers|ceremony|nude|cemetery|grave|memorial|sketch|drawing|fresco|museum|map of|flag of|personality|personality rights/i;
async function fetchSafe(url, maxBytes = 12 * 1024 * 1024) {
  const u = new URL(url);
  if (
    u.protocol !== 'https:' ||
    !['commons.wikimedia.org', 'upload.wikimedia.org', 'thumb.wikimedia.org'].includes(u.hostname)
  )
    throw new Error('Unapproved source host');
  const response = await fetch(u, {
    headers: { 'User-Agent': agent },
    redirect: 'error',
    signal: AbortSignal.timeout(45000),
  });
  if (response.status === 429 || response.status === 503)
    throw new Error('Source requested backoff; stop and retry later.');
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw new Error('Source image too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
for (const [country, minLat, maxLat, minLng, maxLng] of regions) {
  if (records.length >= limit) break;
  const theme = process.env.PHOTO_THEME || '';
  if (!['', 'landscape', 'mountain', 'coast'].includes(theme))
    throw new Error('Unsupported photo theme');
  const q = `incategory:CC-Zero hastemplate:Location ${country} ${theme}`;
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: q,
    gsrnamespace: '6',
    gsrlimit: '50',
    prop: 'imageinfo|coordinates|revisions',
    rvprop: 'ids',
    coprimary: 'all',
    colimit: 'max',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1600',
  });
  const response = JSON.parse(await fetchSafe(`https://commons.wikimedia.org/w/api.php?${params}`));
  await pause();
  let accepted = 0;
  const pages = Object.values(response.query?.pages || {}).sort(
    (a, b) => (a.index || 0) - (b.index || 0),
  );
  for (const page of pages) {
    if (accepted >= 9 || records.length >= limit) break;
    const info = page.imageinfo?.[0],
      m = info?.extmetadata || {},
      lat = Number(m.GPSLatitude?.value),
      lng = Number(m.GPSLongitude?.value),
      id = `commons-${page.pageid}`;
    if (
      ids.has(id) ||
      !info?.thumburl ||
      !/^image\/(jpeg|png|webp)$/.test(info.mime || 'image/jpeg') ||
      m.LicenseShortName?.value !== 'CC0' ||
      m.Restrictions?.value ||
      !m.GPSLatitude ||
      !m.GPSLongitude ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < minLat ||
      lat > maxLat ||
      lng < minLng ||
      lng > maxLng ||
      info.width < 1000 ||
      info.height < 650 ||
      reject.test(page.title) ||
      reject.test(m.Categories?.value || '') ||
      !page.coordinates?.some(
        (c) => Math.abs(c.lat - lat) < 0.0001 && Math.abs(c.lon - lng) < 0.0001,
      )
    )
      continue;
    if (records.some((a) => Math.abs(a.lat - lat) < 0.012 && Math.abs(a.lng - lng) < 0.012))
      continue;
    try {
      const original = await fetchSafe(info.thumburl);
      const buffer = await sharp(original, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer();
      if (buffer.length > 1024 * 1024) continue;
      const hash = createHash('sha256').update(buffer).digest('hex');
      if (records.some((a) => a.sha256 === hash)) continue;
      await fs.writeFile(path.join(directory, `${id}.jpg`), buffer);
      const record = {
        id,
        key: `${id}.jpg`,
        status: 'candidate',
        country,
        lat,
        lng,
        bytes: buffer.length,
        sha256: hash,
        createdAt: Date.now(),
        sourceRevision: page.revisions?.[0]?.revid,
        retrievedAt: new Date().toISOString(),
        cameraEvidence: { lat, lng, source: 'Commons camera location template and GeoData match' },
        credit: {
          title: page.title.replace(/^File:/, ''),
          author: text(m.Artist?.value).slice(0, 300),
          source: `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(page.title.slice(5))}`,
          descriptionPage: info.descriptionurl,
          license: 'CC0-1.0',
          licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        },
        sourceMetadata: m,
      };
      // Link to the description/licence page, not directly to the photo bytes.
      record.credit.source = info.descriptionurl;
      records.push(record);
      ids.add(id);
      accepted++;
      await fs.writeFile(manifestPath, JSON.stringify(records, null, 2));
    } catch (e) {
      console.log(JSON.stringify({ country, id, error: e.message }));
      if (/backoff/.test(e.message)) throw e;
    }
    await pause();
  }
  console.log(JSON.stringify({ country, candidates: accepted, total: records.length }));
}
console.log(
  JSON.stringify({
    candidates: records.length,
    manifest: manifestPath,
    status: 'Awaiting visual and rights review; nothing published.',
  }),
);
