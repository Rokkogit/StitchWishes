// Upload rules. Pure — the Blob call itself is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_UPLOAD_BYTES,
  ALLOWED_TYPES,
  checkUpload,
  uploadName,
} from '../lib/upload.mjs';

/* ------------------------------------------------------------ checkUpload */

test('a normal resized photograph is accepted', () => {
  const result = checkUpload({ type: 'image/jpeg', size: 320_000 });

  assert.equal(result.ok, true);
});

test('every allowed type is actually accepted', () => {
  for (const type of ALLOWED_TYPES) {
    assert.equal(checkUpload({ type, size: 1000 }).ok, true, type);
  }
});

// The browser resizes before uploading, so anything arriving at full phone
// size means the resize did not happen and something is wrong.
test('a file over the ceiling is refused', () => {
  const result = checkUpload({ type: 'image/jpeg', size: MAX_UPLOAD_BYTES + 1 });

  assert.equal(result.ok, false);
  assert.match(result.error, /large/i);
});

test('an empty file is refused', () => {
  assert.equal(checkUpload({ type: 'image/jpeg', size: 0 }).ok, false);
});

// An upload endpoint that accepts anything is free file hosting for the
// internet, and a stored .html or .svg on our own domain is worse than that.
test('non-image types are refused', () => {
  for (const type of [
    'text/html',
    'image/svg+xml',
    'application/pdf',
    'application/javascript',
    'application/octet-stream',
    '',
    undefined,
  ]) {
    const result = checkUpload({ type, size: 1000 });
    assert.equal(result.ok, false, 'expected rejection: ' + String(type));
  }
});

test('a content type with parameters is still matched on the type itself', () => {
  assert.equal(checkUpload({ type: 'image/jpeg; charset=binary', size: 1000 }).ok, true);
});

/* ------------------------------------------------------------- uploadName */

test('uploadName keeps the extension for the type', () => {
  assert.match(uploadName('image/jpeg'), /\.jpg$/);
  assert.match(uploadName('image/png'), /\.png$/);
  assert.match(uploadName('image/webp'), /\.webp$/);
});

test('uploadName puts uploads under their own prefix', () => {
  assert.match(uploadName('image/jpeg'), /^uploads\//);
});

// Two photographs taken in the same second must not collide.
test('uploadName is unique across rapid calls', () => {
  const names = new Set(Array.from({ length: 200 }, () => uploadName('image/jpeg')));

  assert.equal(names.size, 200);
});

// The name ends up in a URL that the catalog validator has to accept.
test('uploadName produces only characters the catalog allows in a blob URL', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.match(uploadName('image/jpeg'), /^[A-Za-z0-9/_.-]+$/);
  }
});
