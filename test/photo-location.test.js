import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readPhotoLocation } from '../client/src/photo-location.js';

const image = () => sharp({create:{width:16,height:16,channels:3,background:'#63864c'}});

test('GPS is extracted automatically from original EXIF, including hemisphere signs', async () => {
  const data = await image().withExif({IFD3:{GPSLatitudeRef:'S',GPSLatitude:'33/1 51/1 2448/100',GPSLongitudeRef:'W',GPSLongitude:'151/1 12/1 5508/100'}}).jpeg().toBuffer();
  const result = await readPhotoLocation(data);
  assert.equal(result.gpsStatus,'found');
  assert.equal(result.gps,true);
  assert.ok(Math.abs(result.location.lat + 33.8568)<0.00001);
  assert.ok(Math.abs(result.location.lng + 151.2153)<0.00001);
});

test('a zero coordinate is a valid GPS location', async () => {
  const data = await image().withExif({IFD3:{GPSLatitudeRef:'N',GPSLatitude:'0/1 0/1 0/1',GPSLongitudeRef:'E',GPSLongitude:'0/1 0/1 0/1'}}).jpeg().toBuffer();
  assert.deepEqual((await readPhotoLocation(data)).location,{lat:0,lng:0});
});

test('camera metadata without GPS is reported as missing, not a parser failure', async () => {
  const data = await image().withExif({IFD0:{Make:'Apple',Model:'iPhone 12 mini'}}).jpeg().toBuffer();
  assert.deepEqual(await readPhotoLocation(data),{location:null,gpsStatus:'missing',gps:false});
});

test('metadata-free images and unreadable files have distinct explanations', async () => {
  const clean = await image().jpeg().toBuffer();
  assert.equal((await readPhotoLocation(clean)).gpsStatus,'missing');
  assert.equal((await readPhotoLocation(Buffer.from('invalid image'))).gpsStatus,'unreadable');
});
