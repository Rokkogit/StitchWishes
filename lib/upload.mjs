// What may be uploaded, and what it gets called.
//
// Pure. The Blob call lives in the endpoint; these are the rules that decide
// whether it should happen at all.

import { randomUUID } from 'node:crypto';

// The browser resizes to 1600px before uploading, which puts a phone
// photograph at roughly 200-500 KB — the same range as the 60 photographs
// already in the catalog. This ceiling is well above that but well under
// Vercel's 4.5 MB request limit, so anything hitting it means the resize did
// not happen rather than that someone has an unusually large photograph.
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

// Raster formats browsers can actually draw, and nothing else.
//
// SVG is deliberately excluded despite being an image: it can carry script,
// and these files are served from a domain the admin session trusts. HEIC is
// excluded too — browsers cannot display it, which is exactly why two
// photographs from the original catalog are missing. The browser converts
// HEIC to JPEG during the resize, so nothing is lost by refusing it here.
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function checkUpload({ type, size } = {}) {
  // Content types may carry parameters ("image/jpeg; charset=binary"); match
  // on the type itself.
  const mime = String(type ?? '').split(';')[0].trim().toLowerCase();

  if (!ALLOWED_TYPES.includes(mime)) {
    return { ok: false, error: 'Photographs only — JPEG, PNG or WebP.' };
  }

  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'That file is empty.' };
  }

  if (size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `That photograph is too large at ${Math.round(size / 1024)} KB. The limit is ${Math.round(MAX_UPLOAD_BYTES / 1024)} KB.`,
    };
  }

  return { ok: true, mime };
}

// A UUID rather than the original filename: two photographs taken in the same
// second would otherwise collide, and a name off a phone can contain anything.
// The result has to survive the catalog's blob URL pattern, so it stays inside
// [A-Za-z0-9/_.-].
export function uploadName(type) {
  const mime = String(type ?? '').split(';')[0].trim().toLowerCase();
  const extension = EXTENSIONS[mime] ?? 'jpg';

  return `uploads/${randomUUID()}.${extension}`;
}
