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

    // No pre-flight check for one particular variable.
    //
    // There is more than one way for a Blob store to be connected, and this
    // used to insist on exactly one of them. A store connected the way Vercel
    // connects them now hands over BLOB_STORE_ID plus a token injected into
    // the runtime, and no BLOB_READ_WRITE_TOKEN anywhere - so a store that
    // was connected and working was refused before anything was attempted,
    // with a message telling her to go and create the store she had already
    // created.
    //
    // The SDK is the one thing that knows every way it can authenticate, and
    // it says so plainly when it cannot. So it decides, and its answer gets
    // translated below. A third way to connect a store cannot break this.

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
      const said = error?.message ?? 'unknown error';

      // The SDK's own words for "there is nothing here to authenticate with".
      // Configuration rather than a fault, so it says what to go and do.
      if (/no blob credentials|no read-write token/i.test(said)) {
        console.error('[admin-upload] no blob credentials:', said);
        return json(503, {
          error:
            'Photo storage is not connected yet. In Vercel: Storage, open the Blob store, ' +
            'Connect Project — then redeploy so the setting reaches the site.',
        });
      }

      console.error('[admin-upload] blob put failed:', said);
      return json(502, { error: `Storing the photograph failed: ${said}` });
    }
  },
};
