// Guards a CSS bug that cost a debugging session.
//
// The admin panel toggles elements with the `hidden` attribute. That attribute
// works through a user-agent rule, [hidden] { display: none }, which ANY author
// `display` declaration outranks. Both .gate-wrap and .picker set display, so
// hiding them did nothing: the gate kept its 100vh and pushed the workroom off
// the bottom of the page. It looked exactly like an editor that had crashed,
// and nothing threw, so there was no error to find.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, '..', 'stitch-wishes-2050', name), 'utf8');

test('admin.css neutralises the display-beats-hidden trap', () => {
  const css = read('admin.css').replace(/\s+/g, ' ');

  assert.match(
    css,
    /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    'admin.css must force [hidden] to display:none, or any rule setting display silently defeats it'
  );
});

test('every element the admin toggles with hidden is covered by that rule', () => {
  const js = read('admin.js') + read('admin-catalog.js');
  const css = read('admin.css').replace(/\s+/g, ' ');

  // If something is toggled via .hidden anywhere, the override has to exist.
  const toggles = js.match(/\.hidden\s*=/g) ?? [];
  assert.ok(toggles.length > 0, 'this guard assumes the panel toggles hidden');

  assert.ok(
    /\[hidden\]/.test(css),
    `${toggles.length} hidden-toggles in the admin scripts and no [hidden] rule in admin.css`
  );
});

test('the gate wrapper and picker still declare a display, so the rule stays load-bearing', () => {
  const css = read('admin.css').replace(/\s+/g, ' ');

  // If either stops setting display this test can go, but while they do, the
  // override above is the only thing making `hidden` work on them.
  const gateSetsDisplay = /\.gate-wrap\s*\{[^}]*display:/.test(css);
  const pickerSetsDisplay = /\.picker\s*\{[^}]*display:/.test(css);

  assert.ok(
    gateSetsDisplay || pickerSetsDisplay,
    'neither sets display any more — check whether the [hidden] override is still needed'
  );
});

/* --------------------------------------------------- uploading a photograph */

test('an upload message is rendered from state, not written onto a doomed node', () => {
  // The bug this guards: say() wrote straight to the status element and
  // renderPicker() replaced the whole panel on the very next line, so a
  // refused upload destroyed its own error message in the same tick. From the
  // outside that is indistinguishable from the button doing nothing.
  const js = read('admin-catalog.js');

  assert.match(js, /pickerNote/, 'the picker message no longer lives in state');
  assert.match(
    js,
    /state\.pickerNote = text \? \{ text, tone \} : null/,
    'say() no longer records the message where a re-render cannot reach it'
  );
  assert.match(
    js,
    /data-upload-status \$\{note \? '' : 'hidden'\}/,
    'renderPicker no longer draws the message it was given'
  );
});

test('a failed upload is coloured like a failure', () => {
  const css = read('admin.css');

  assert.match(css, /\.picker__status--bad/);
  assert.match(css, /\.picker__status--good/);

  // Equal specificity, so the modifiers have to come after the base rule or
  // source order quietly cancels them.
  assert.ok(
    css.indexOf('.picker__status--bad') > css.indexOf('.picker__status {'),
    'the modifiers sit before the base rule and are overridden by it'
  );
});

test('the picker keeps uploaded photographs apart from the shipped ones', () => {
  const js = read('admin-catalog.js');

  assert.match(js, /function groupAssets/, 'the two kinds are not separated');
  assert.match(js, /Photos you uploaded/);
  assert.match(js, /Photos that came with the site/);
});

test('what counts as uploaded is the thing that is actually true of it', () => {
  // An uploaded photograph is an absolute URL in the Blob store; one that came
  // with the site is a relative path under assets/.
  const js = read('admin-catalog.js');
  const match = js.match(/const isUploaded = \(src\) => (.+);/);

  assert.ok(match, 'nothing decides which group a photograph belongs to');

  const isUploaded = new Function('src', `return ${match[1].replace('(src) =>', '')}`);

  assert.equal(isUploaded('https://abc.public.blob.vercel-storage.com/uploads/x.jpg'), true);
  assert.equal(isUploaded('http://example.com/x.jpg'), true);
  assert.equal(isUploaded('assets/F00BB062.jpg'), false);
  assert.equal(isUploaded(''), false);
  assert.equal(isUploaded(null), false);
});
