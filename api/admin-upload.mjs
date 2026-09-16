// POST a photograph -> stores it in Vercel Blob, returns its URL.
//
// The browser resizes and re-encodes before sending, so what arrives here is
// already a few hundred KB of JPEG rather than a multi-megabyte phone
// photograph. That is what keeps this a plain server upload: Vercel caps a
// request body at 4.5 MB, and anything larger would need the client-token
// dance instead.

import { put } from '@vercel/blob';

import { json, methodNotAllowed } from '../lib/http.mjs';
import { readConfig, verifyToken, readCookie, COOKIE_NAME } from '../lib/session.mjs';
import { checkUpload, uploadName } from '../lib/upload.mjs';

function authorized(request) {
  const config = readConfig(process.env);
  if (!config.ok) return false;

  const token = readCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (!token) return false;

  return verifyToken(config.secret, token).valid;
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return methodNotAllowed('POST');

    // Before anything is read, let alone stored. An upload endpoint without
    // this is free file hosting for the whole internet, on your domain.
    if (!authorized(request)) return json(401, { error: 'Sign in first.' });

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.error('[admin-upload] BLOB_READ_WRITE_TOKEN is unset');
      return json(503, {
        error: 'Photo storage is not set up yet. Create a Blob store in the Vercel dashboard.',
      });
    }

    const type = request.headers.get('content-type') ?? '';

    let body;
    try {
      body = await request.arrayBuffer();
    } catch {
      return json(400, { error: 'Could not read that file.' });
    }

    const check = checkUpload({ type, size: body.byteLength });
    if (!check.ok) return json(400, { error: check.error });

    try {
      const blob = await put(uploadName(check.mime), body, {
        access: 'public',
        contentType: check.mime,
        // The name already carries a UUID; a second suffix would only make
        // the URL longer without making it more unique.
        addRandomSuffix: false,
      });

      return json(200, { url: blob.url, size: body.byteLength });
    } catch (error) {
      console.error('[admin-upload] blob put failed:', error?.message);
      return json(502, { error: `Storing the photograph failed: ${error?.message ?? 'unknown error'}` });
    }
  },
};
