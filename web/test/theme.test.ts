// The theme's structural invariants, checked against the stylesheets themselves.
//
// The browser suite cannot cover this: those tests mount the renderer without
// ui/patcher.css, so every colour assertion there resolves through domainColor()'s
// fallbacks and would pass just as happily if the light theme did not exist. What can go
// wrong is not a wrong shade — it is a token added to one theme and forgotten in the
// other (silently inheriting the light value in dark mode, or vice versa), or a raw hex
// dropped into a rule, which looks right in whichever theme it was written in and wrong
// in the other with nothing to catch it. Both are text-level properties of the CSS, so
// that is where they are asserted.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

const PATCHER_CSS = read('../src/ui/patcher.css');

/** The body of a `:root…{ }` block, by its selector. */
function block(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `${selector} should exist in patcher.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  const close = css.indexOf('\n}', open);
  return css.slice(open + 1, close);
}

/** `--name: value` pairs declared in a block, comments stripped. */
function tokens(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

const looksLikeColour = (v: string) => /^(#|rgb|hsl)/i.test(v);

const LIGHT = tokens(block(PATCHER_CSS, ':root {'));
const DARK = tokens(block(PATCHER_CSS, ":root[data-theme='dark'] {"));

describe('theme tokens', () => {
  it('defines a light default and a dark override', () => {
    expect(LIGHT.size).toBeGreaterThan(20);
    expect(DARK.size).toBeGreaterThan(20);
  });

  it('gives every colour in the default theme a dark counterpart', () => {
    const missing = [...LIGHT].filter(([k, v]) => looksLikeColour(v) && !DARK.has(k)).map(([k]) => k);
    expect(missing, 'colour tokens with no dark value would inherit the light one').toEqual([]);
  });

  it('declares nothing in the dark theme that the default theme lacks', () => {
    // A dark-only token is dead in light mode and resolves to nothing, which paints as
    // transparent rather than as an error.
    const orphans = [...DARK.keys()].filter((k) => !LIGHT.has(k));
    expect(orphans).toEqual([]);
  });

  it('keeps metrics out of the theme override', () => {
    // A token whose value differs between themes but is not a colour is a layout that
    // shifts when you toggle — always a bug, never a design.
    const metrics = [...DARK].filter(([, v]) => !looksLikeColour(v)).map(([k]) => k);
    expect(metrics).toEqual([]);
  });

  it('actually differs: no token is the same in both themes', () => {
    const identical = [...DARK].filter(([k, v]) => LIGHT.get(k) === v).map(([k]) => k);
    // --unknown-stroke is deliberately shared: a red that reads on both grounds, and the
    // one signal ("this is not a Max object") that must never be theme-dependent.
    expect(identical).toEqual(['--unknown-stroke']);
  });
});

describe('no raw colour outside the theme', () => {
  const HEX = /#[0-9a-fA-F]{3,8}\b/g;

  it('patcher.css uses tokens everywhere below the theme blocks', () => {
    const rules = PATCHER_CSS.slice(PATCHER_CSS.indexOf('/* ══ CANVAS COLOUR'));
    expect(rules.match(HEX) ?? []).toEqual([]);
  });

  it('patch.css uses tokens except where a colour is not a theme choice', () => {
    // A piano keyboard is white-and-black in any theme, and the drop shadow is an alpha
    // black that works on both grounds. Everything else must come from a token.
    const ALLOWED = new Set(['#eef1f4', '#333', '#2a2e35', '#0007']);
    const stray = (read('../src/ui/patch.css').match(HEX) ?? []).filter((h) => !ALLOWED.has(h));
    expect(stray).toEqual([]);
  });

  it('the panes that build their own CSS use tokens too', () => {
    for (const file of ['../src/ui/palette.ts', '../src/ui/box-editor.ts', '../src/ui/inspector.ts']) {
      expect(read(file).match(HEX) ?? [], `${file} should not hardcode colour`).toEqual([]);
    }
  });
});
