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
