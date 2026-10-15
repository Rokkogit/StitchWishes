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

/* ---------------------------------------------------- adding a new piece */

test('a new piece is visible, so adding one takes a single save', () => {
  // It used to be created hidden. That meant save, untick Hidden, save again -
  // two saves to add one thing, with the second easy to forget and nothing on
  // screen to say the piece was still not on the site.
  const js = read('admin-catalog.js');
  const add = js.slice(js.indexOf('function addPiece()'), js.indexOf('function removePiece('));

  assert.match(add, /hidden: false/, 'a new piece is created hidden again');
  assert.doesNotMatch(add, /hidden: true/);
});

test('the custom colour is offered per piece, not shop-wide', () => {
  // It is a promise to make the thing in whatever colour is asked for. True of
  // resin and beads, not true of a printed mousepad.
  const js = read('admin-catalog.js');

  assert.match(js, /function colourEditHtml/);
  assert.match(js, /data-colour-on/, 'there is no switch for it');
  assert.match(js, /data-colour-label/, 'it cannot be named');
});

test('switching the colour off clears it rather than storing a disabled one', () => {
  const js = read('admin-catalog.js');
  const handler = js.slice(js.indexOf('function onColourField'), js.indexOf('function onChange'));

  assert.match(handler, /: null;/, 'switching it off leaves a disabled block behind');
});

/* ---------------------------------------------------------- promotions */

test('the promotions tab exists and has a panel to draw into', () => {
  // A tab with no panel switches to a blank screen, which is the failure the
  // rest of this file was written about.
  const html = read('admin.html');

  assert.match(html, /data-tab="promotions"/, 'there is no Promotions tab');
  assert.match(html, /data-promotions role="tabpanel"/, 'the tab has nowhere to render');
});

test('every admin tab has a panel, and every panel has a tab', () => {
  // The general version, so the next tab added cannot be half-wired.
  const html = read('admin.html');

  const tabs = [...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
  const panels = [...html.matchAll(/<main[^>]*data-([a-z]+) role="tabpanel"/g)].map((m) => m[1]);

  assert.deepEqual(tabs.sort(), panels.sort());
});

test('switching to the promotions tab draws it', () => {
  const js = read('admin-catalog.js');

  assert.match(js, /name === 'promotions'\) renderPromotions\(\)/);
  assert.match(js, /el\.promotionsPanel\.hidden = name !== 'promotions'/);
  assert.match(js, /el\.promotionsPanel = \$\('\[data-promotions\]'\)/);
});

test('the panel agrees with the server about what counts as live', () => {
  // promoStatus mirrors statusOf in lib/promotions.mjs. The server decides for
  // real; this only has to say the same thing on screen.
  const js = read('admin-catalog.js');
  const fn = js.slice(js.indexOf('function promoStatus'), js.indexOf('function promoSentence'));

  for (const state of ['off', 'scheduled', 'ended', 'used up', 'live']) {
    assert.ok(fn.includes(`'${state}'`), `the panel cannot show "${state}"`);
  }
});

test('the bag can take a code and say what happened to it', () => {
  const bag = readFileSync(new URL('../stitch-wishes-2050/bag.js', import.meta.url), 'utf8');

  assert.match(bag, /data-code-form/, 'there is nowhere to type a code');
  assert.match(bag, /codeProblem/, 'a refused code would fail silently');
  assert.match(bag, /JSON\.stringify\(\{ cart, code \}\)/, 'the code never reaches the quote');
  assert.match(
    bag,
    /JSON\.stringify\(\{ cart: window\.StitchCart\.read\(\), code \}\)/,
    'the code never reaches the checkout, so the discount would vanish at the till'
  );
});

test('every panel that draws controls is actually listening', () => {
  // The bug this guards: el.main is the CATALOG panel alone, not the whole
  // page. A handler hung on it never hears a click in any other panel, so the
  // Promotions Add buttons did nothing whatsoever - no error, no clue.
  const js = read('admin-catalog.js');

  const listening = new Set(
    [...js.matchAll(/el\.([A-Za-z]+Panel)\.addEventListener\('click'/g)].map((m) => m[1])
  );

  for (const panel of ['ordersPanel', 'lookPanel', 'homepagePanel', 'checkoutPanel', 'promotionsPanel']) {
    assert.ok(listening.has(panel), `${panel} draws controls that nothing is listening to`);
  }
});

test('the promotions panel hears typing as well as clicks', () => {
  // A select changes, a text box inputs. Missing either means a field that
  // looks editable and silently keeps its old value.
  const js = read('admin-catalog.js');

  assert.match(js, /el\.promotionsPanel\.addEventListener\('input', onPromoField\)/);
  assert.match(js, /el\.promotionsPanel\.addEventListener\('change', onPromoField\)/);
});

test('the tab strip can never hide a tab', () => {
  // It was a plain flex row. Fine for five tabs, and the moment there were six
  // the last two went off the right-hand edge with nothing to suggest they
  // existed - no wrap, no scroll. A tab nobody can reach is a tab that is not
  // there, and the next section added would do it again.
  const css = read('admin.css').replace(/\s+/g, ' ');
  const strip = css.slice(css.indexOf('.tabs {'), css.indexOf('.tab {'));

  assert.match(strip, /flex-wrap: wrap|overflow-x: auto/, 'tabs can overflow out of reach');
});

test('every tab in the strip is one the panel knows how to draw', () => {
  // A tab that switches to a blank screen is worse than no tab.
  const html = read('admin.html');
  const js = read('admin-catalog.js');

  for (const [, name] of html.matchAll(/data-tab="([a-z]+)"/g)) {
    assert.match(
      js,
      new RegExp(`name !== '${name}'|name === '${name}'`),
      `the ${name} tab has nothing behind it`
    );
  }
});
