import exifr from 'exifr';

// Read the original file before the preview or shared image is resized.
export async function readPhotoLocation(file) {
  try {
    const gps = await exifr.gps(file);
    if (
      Number.isFinite(gps?.latitude) &&
      Number.isFinite(gps?.longitude) &&
      Math.abs(gps.latitude) <= 90 &&
      Math.abs(gps.longitude) <= 180
    ) {
      return { location: { lat: gps.latitude, lng: gps.longitude }, gpsStatus: 'found', gps: true };
    }
    return { location: null, gpsStatus: 'missing', gps: false };
  } catch {
    return { location: null, gpsStatus: 'unreadable', gps: false };
  }
}
