// How the site looks, as data.
//
// The risk a colour picker introduces is not an ugly shop - it is an unreadable
// one, shipped without anyone noticing. Most of this is about that.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESETS,
  DEFAULT_THEME,
  validateTheme,
  themeVars,
  themeWarnings,
  contrast,
  presetById,
  READABLE,
} from '../lib/theme.mjs';

test('every preset is readable before anyone touches it', () => {
  // A palette that ships unreadable is worse than no palettes at all.
  for (const preset of PRESETS) {
    const vars = themeVars({ preset: preset.id });
    const ratio = contrast(vars['--paper'], vars['--ink']);

    assert.ok(ratio >= READABLE, `${preset.label} is only ${ratio}:1`);
  }
});

test('an unreadable choice is reported rather than silently shipped', () => {
  // Reported, not refused. It is her shop.
  const warnings = themeWarnings({ preset: 'aurora', tokens: { ink: '#f4fdff' } });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /hard to read/);
});

test('a readable choice produces no noise', () => {
  assert.deepEqual(themeWarnings(DEFAULT_THEME), []);
});

test('a dark theme gets light hairlines, or they vanish', () => {
  const dark = themeVars({ preset: 'midnight' });
  const light = themeVars({ preset: 'aurora' });

  assert.match(dark['--line'], /255, 255, 255/);
  assert.match(light['--line'], /13, 42, 49/);
});

test('an override replaces one colour and leaves the rest of the preset', () => {
  const vars = themeVars({ preset: 'hunny', tokens: { paper: '#ffffff' } });

  assert.equal(vars['--paper'], '#ffffff');
  assert.equal(vars['--ink'], presetById('hunny').tokens.ink);
});

test('a colour that is not a colour falls back instead of breaking the page', () => {
  for (const bad of ['red', '#fff', 'rgb(0,0,0)', '', null, 42, '#gggggg']) {
    const { value } = validateTheme({ preset: 'aurora', tokens: { paper: bad } });
    assert.equal(value.tokens.paper, undefined, JSON.stringify(bad));
  }

  // And the rendered value is the preset's.
  assert.equal(themeVars({ tokens: { paper: 'red' } })['--paper'], presetById('aurora').tokens.paper);
});

test('an unknown preset falls back to the first rather than to nothing', () => {
  assert.equal(validateTheme({ preset: 'does-not-exist' }).value.preset, PRESETS[0].id);
  assert.equal(validateTheme(null).value.preset, PRESETS[0].id);
});

test('square corners are a real choice, not a missing value', () => {
  // 0 is falsy, which is exactly how it gets treated as "unset" by accident.
  assert.equal(validateTheme({ radius: 0 }).value.radius, 0);
  assert.equal(themeVars({ radius: 0 })['--radius'], '0px');
});

test('roundness is clamped rather than refused', () => {
  assert.equal(validateTheme({ radius: 9999 }).value.radius, 40);
  assert.equal(validateTheme({ radius: -50 }).value.radius, 0);
  assert.equal(validateTheme({ radius: 'fat' }).value.radius, 20);
});

test('density changes every spacing step together', () => {
  const tight = themeVars({ density: 'tight' });
  const airy = themeVars({ density: 'airy' });

  for (let i = 1; i <= 6; i += 1) {
    assert.ok(parseFloat(tight[`--s${i}`]) < parseFloat(airy[`--s${i}`]), `--s${i} did not change`);
  }
});

test('sections default to shown, and only an explicit false hides one', () => {
  assert.deepEqual(validateTheme({}).value.sections, {
    hero: true,
    featured: true,
    maker: true,
    picks: true,
  });

  assert.equal(validateTheme({ sections: { hero: false } }).value.sections.hero, false);
  // Anything else means shown - an absent key must not hide a section.
  assert.equal(validateTheme({ sections: { hero: undefined } }).value.sections.hero, true);
});

test('every token the stylesheet needs comes out of a theme', () => {
  const vars = themeVars(DEFAULT_THEME);

  for (const name of ['--paper', '--ink', '--ink-soft', '--aurora', '--line', '--radius', '--s1', '--s6']) {
    assert.ok(vars[name], `${name} is missing`);
  }
});

test('contrast is computed the way WCAG defines it', () => {
  // Known anchors: black on white is 21:1, anything on itself is 1:1.
  assert.equal(contrast('#ffffff', '#000000'), 21);
  assert.equal(contrast('#123456', '#123456'), 1);
});
