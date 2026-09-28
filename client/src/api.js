let csrfToken = '';
export async function api(path, options = {}) {
  const sentAt = Date.now();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...options.headers,
    },
  });
  const body = await response
    .json()
    .catch(() => ({ error: 'The server could not be reached. Please try again.' }));
  const receivedAt = Date.now();
  const serverReceived = Number(response.headers.get('X-TripGuessr-Received-At'));
  const serverSent = Number(response.headers.get('X-TripGuessr-Sent-At'));
  for (const value of [body, body.run])
    if (value?.serverNow)
      value.clockOffsetMs =
        serverReceived && serverSent
          ? (serverReceived - sentAt + (serverSent - receivedAt)) / 2
          : value.serverNow - (sentAt + receivedAt) / 2;
  if (body.csrfToken) csrfToken = body.csrfToken;
  if (!response.ok) {
    const error = new Error(body.error || 'Something went wrong.');
    error.status = response.status;
    throw error;
  }
  return body;
}
export const json = (method, body) => ({ method, body: JSON.stringify(body) });
export const formatDistance = (value) =>
  value == null
    ? 'No guess'
    : value < 1
      ? `${Math.round(value * 1000)} m`
      : `${Math.round(value).toLocaleString()} km`;

export async function preparePhoto(file) {
  if (file.size > 25 * 1024 * 1024)
    throw new Error(`${file.name} is too large. Please use a photo under 25 MB.`);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error(
        `Couldn’t open ${file.name}. Use JPG, PNG, or WebP. For HEIC photos, export as JPG first.`,
      );
    });
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob || blob.size > 2 * 1024 * 1024)
      throw new Error(`${file.name} is too detailed. Try a smaller image.`);
    return { file: blob, url: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function copyLink(id, notify) {
  try {
    await navigator.clipboard.writeText(`${location.origin}/g/${id}`);
    notify('Trip invitation copied — it does not include your results.');
  } catch {
    notify('Copy the trip link from your address bar or the share box.');
  }
}
