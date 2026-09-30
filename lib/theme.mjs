// How the site looks, as data.
//
// The whole stylesheet reads from custom properties - 261 rules do - and every
// one of them is defined in a single :root block. So changing how the site
// looks means overriding a handful of tokens, not editing CSS. That is the
// only reason this is a small file rather than a page builder.
//
// What is deliberately NOT here: arbitrary layout. Free positioning of
// arbitrary blocks is months of work and reliably produces something worse
// than a fixed design that was actually designed. What is here is the set of
// choices that change the character of the site without being able to break
// it: colour, roundness, density, and which sections appear.

export const PRESETS = Object.freeze([
  {
    id: 'aurora',
    label: 'Aurora',
    note: 'The original. Iridescent, pale, cool.',
    tokens: {
      paper: '#f2fafc',
      ink: '#0d2a31',
      inkSoft: '#4a6e75',
      aurora: '#8fd4e6',
      periwinkle: '#9cc2e6',
      lilac: '#e4cce4',
      blossom: '#f0c0e4',
      peach: '#fcd8cc',
      mint: '#aee2d2',
    },
  },
  {
    id: 'hunny',
    label: 'Hunny',
    note: 'Warm cream and honey. Softer, cosier.',
    tokens: {
      paper: '#fdf6ec',
      ink: '#3a2a18',
      inkSoft: '#7a6247',
      aurora: '#f2c879',
      periwinkle: '#e8b98c',
      lilac: '#f0d9c0',
      blossom: '#f5c9a8',
      peach: '#fbe3c8',
      mint: '#d9d2a8',
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    note: 'Deep space. The pieces glow against it.',
    tokens: {
      paper: '#12131f',
      ink: '#f0f1fa',
      inkSoft: '#a9adc8',
      aurora: '#6f7ce8',
      periwinkle: '#8a6fd8',
      lilac: '#b06fd0',
      blossom: '#d96fb4',
      peach: '#f0899a',
      mint: '#5fc9c0',
    },
  },
  {
    id: 'blossom',
    label: 'Blossom',
    note: 'Pink-forward, the way the pens photograph.',
    tokens: {
      paper: '#fdf3f7',
      ink: '#3d1f31',
      inkSoft: '#7d556c',
      aurora: '#f5a8c8',
      periwinkle: '#e69ad4',
      lilac: '#f0c4e4',
      blossom: '#f8b8d4',
      peach: '#fbd4d0',
      mint: '#d8bce8',
    },
  },
  {
    id: 'plain',
    label: 'Plain',
    note: 'No iridescence. Quiet, gallery-like.',
    tokens: {
      paper: '#faf9f7',
      ink: '#1c1c1a',
      inkSoft: '#61605c',
      aurora: '#c9c7c1',
      periwinkle: '#bdbbb5',
      lilac: '#d4d2cc',
      blossom: '#cfcdc7',
      peach: '#dedcd6',
      mint: '#c4c8c2',
    },
  },
]);

export const DEFAULT_THEME = Object.freeze({
  preset: 'aurora',
  // Only set when someone has moved a colour off its preset. Empty means "use
  // the preset", so switching presets keeps working rather than being
  // permanently overridden by values copied out of the first one.
  tokens: Object.freeze({}),
  radius: 20,        // px, corner roundness
  density: 'normal', // 'tight' | 'normal' | 'airy'
  sections: Object.freeze({
    hero: true,
    featured: true,
    maker: true,
    picks: true,
  }),
});

const TOKEN_KEYS = Object.freeze([
  'paper',
  'ink',
  'inkSoft',
  'aurora',
  'periwinkle',
  'lilac',
  'blossom',
  'peach',
  'mint',
]);

// The CSS custom property each one drives.
const CSS_NAME = Object.freeze({
  paper: '--paper',
  ink: '--ink',
  inkSoft: '--ink-soft',
  aurora: '--aurora',
  periwinkle: '--periwinkle',
  lilac: '--lilac',
  blossom: '--blossom',
  peach: '--peach',
  mint: '--mint',
});

const HEX = /^#[0-9a-f]{6}$/i;

export const presetById = (id) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/* ------------------------------------------------------------ contrast ---- */

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  if (!HEX.test(hex)) return 0;

  const n = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

// WCAG contrast ratio. Text that cannot be read is the one way a colour picker
// can genuinely break a shop, so the panel warns rather than letting it ship
// silently.
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];

  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export const READABLE = 4.5;

/* ---------------------------------------------------------- validation ---- */

export function validateTheme(theme) {
  // Never refuses, like the rest of the content. A bad colour falls back to the
  // preset rather than taking the site's appearance down with it.
  const source = theme && typeof theme === 'object' ? theme : {};

  const preset = presetById(source.preset).id;

  const tokens = {};
  const given = source.tokens && typeof source.tokens === 'object' ? source.tokens : {};

  for (const key of TOKEN_KEYS) {
    const value = given[key];
    if (typeof value === 'string' && HEX.test(value)) tokens[key] = value.toLowerCase();
  }

  const radius = Number(source.radius);

  const sections = source.sections && typeof source.sections === 'object' ? source.sections : {};

  return {
    ok: true,
    value: {
      preset,
      tokens,
      // Zero is a legitimate choice - square corners - so it is clamped rather
      // than treated as missing.
      radius: Number.isFinite(radius) ? Math.min(Math.max(Math.round(radius), 0), 40) : 20,
      density: ['tight', 'normal', 'airy'].includes(source.density) ? source.density : 'normal',
      sections: {
        hero: sections.hero !== false,
        featured: sections.featured !== false,
        maker: sections.maker !== false,
        picks: sections.picks !== false,
      },
    },
    errors: [],
  };
}

/* -------------------------------------------------------------- output ---- */

// What the browser actually applies. The preset supplies everything; an
// override replaces one value. Returned as pairs rather than a string so the
// page can set them as properties and never has to build CSS text.
export function themeVars(theme) {
  const { value } = validateTheme(theme);
  const base = presetById(value.preset).tokens;

  const vars = {};

  for (const key of TOKEN_KEYS) {
    vars[CSS_NAME[key]] = value.tokens[key] ?? base[key];
  }

  vars['--radius'] = `${value.radius}px`;

  // Ink is the only one with dependents: the hairlines are the ink colour at
  // low opacity, and left alone they would stay dark on a dark theme and
  // vanish. Derived rather than exposed, because nobody wants to pick a
  // border colour.
  const dark = luminance(vars['--ink']) > 0.5;
  vars['--line'] = dark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(13, 42, 49, 0.14)';
  vars['--line-soft'] = dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(13, 42, 49, 0.07)';
  vars['--paper-raised'] = dark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.72)';
  vars['--ink-faint'] = dark ? 'rgba(255, 255, 255, 0.45)' : '#8aa5aa';

  const scale = {
    tight: ['0.4rem', '0.8rem', '1.3rem', '2.2rem', '4rem', '6.5rem'],
    normal: ['0.5rem', '1rem', '1.75rem', '3rem', '5.5rem', '9rem'],
    airy: ['0.6rem', '1.25rem', '2.25rem', '4rem', '7rem', '11rem'],
  }[value.density];

  scale.forEach((step, i) => {
    vars[`--s${i + 1}`] = step;
  });

  return vars;
}

// Checked against the background it actually sits on, which is the only check
// worth doing. Reported rather than enforced: it is her shop.
export function themeWarnings(theme) {
  const vars = themeVars(theme);
  const warnings = [];

  const body = contrast(vars['--paper'], vars['--ink']);
  if (body < READABLE) {
    warnings.push(
      `Text on the background is ${body}:1. Under ${READABLE}:1 it gets hard to read.`
    );
  }

  return warnings;
}
