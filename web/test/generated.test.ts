// Guards the committed generated knowledge files — src/generated/{boxspecs,objdocs}.json.
//
// Nothing regenerates these at build time, so a stale or half-written commit would be
// invisible until the patcher read it. These tests read the files off disk exactly as
// they are committed and assert the invariants their consumers rely on: boxspecs and
// objdocs are both keyed by names manifest.json knows, the 46 argument-dependent-arity
// objects are all still there, and the docstring parser did not shift or mangle rows.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface BoxSpec {
  box: Record<string, unknown>;
  io?: Record<string, unknown[]>;
  attribs: { name: string; type?: string; size?: string }[];
}

interface Xlet {
  index: number;
  type: string;
  text: string;
}

interface ObjDoc {
  digest: string;
  description: string;
  inlets: Xlet[];
  inletDomains: string[];
  outlets: Xlet[];
  messages: string[];
  attributes: string[];
}

interface ManifestEntry {
  numInlets: number;
  numOutlets: number;
  aliasOf?: string;
}

function load<T>(name: string): T {
  const path = fileURLToPath(new URL(`../src/generated/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

const MANIFEST = load<Record<string, ManifestEntry>>('manifest.json');
const BOXSPECS = load<Record<string, BoxSpec>>('boxspecs.json');
const OBJDOCS = load<Record<string, ObjDoc>>('objdocs.json');

/**
 * Objects whose reference docs describe MORE xlets than their default box has, as
 * `<name> <documented>><box>`. Two causes, both in the upstream data, neither a parser
 * bug: 37 objects need a required argument to instantiate, so the OBJ_INFO scrape
 * recorded a 0/0 box; and a handful (dict, mousestate, info~, the jit.qt.* family)
 * simply document xlets the scraped box does not have.
 *
 * Frozen as an exact set, not a tolerance: if the parser ever shifts a docstring onto
 * the wrong object — the failure mode of attaching docs positionally, since max.py puts
 * them before the assignment and msp.py/jit.py after — this set changes and the test
 * fails, which is the whole point of pinning it.
 */
const KNOWN_INLET_DIVERGENCES = [
  'expr 1>0', 'inlet 1>0', 'maxurl 2>1', 'outlet 2>1', 'patcher 1>0', 'pv 1>0',
  'send 1>0', 'setclock 2>0', 'sprintf 1>0', 'value 1>0', 'vexpr 1>0', 'xmidiin 2>1',
  'fftin~ 1>0', 'fftout~ 2>0', 'index~ 2>0', 'lookup~ 3>0', 'mc.index~ 2>0',
  'mc.lookup~ 3>0', 'mc.peek~ 3>0', 'mc.pfft~ 1>0', 'mc.sash~ 3>0', 'mc.twist~ 2>1',
  'peek~ 3>0', 'pfft~ 1>0', 'plugreceive~ 1>0', 'plugsend~ 1>0', 'poke~ 3>0',
  'polybuffer~ 1>0', 'sash~ 3>0', 'stretch~ 1>0', 'twist~ 2>1', 'jit.avc 2>0',
  'jit.dx.grab 2>0', 'jit.dx.videoout 2>0', 'jit.qt.grab 2>1', 'jit.qt.movie 2>1',
  'jit.qt.record 2>1', 'jit.qt.videoout 2>0',
];

const KNOWN_OUTLET_DIVERGENCES = [
  'dict 5>4', 'dict.unpack 2>1', 'expr 1>0', 'mousestate 10>5', 'pv 1>0',
  'setclock 1>0', 'sprintf 1>0', 'value 1>0', 'vexpr 1>0', 'fftin~ 3>0', 'index~ 2>0',
  'info~ 10>9', 'lookup~ 1>0', 'mc.index~ 2>0', 'mc.lookup~ 1>0', 'mc.peek~ 1>0',
  'mc.range~ 3>1', 'mc.sash~ 1>0', 'peek~ 1>0', 'plugreceive~ 1>0', 'poke~ 1>0',
  'polybuffer~ 2>0', 'sash~ 1>0', 'stretch~ 2>0', 'jit.avc 1>0', 'jit.dx.grab 2>0',
  'jit.dx.videoout 2>0', 'jit.qt.videoout 2>0',
];

describe('boxspecs.json', () => {
  it('covers every canonical object exactly once, with no alias duplication', () => {
    const canonical = Object.keys(MANIFEST).filter((n) => !MANIFEST[n].aliasOf);
    expect(Object.keys(BOXSPECS).length).toBe(1005);
    expect(Object.keys(BOXSPECS).sort()).toEqual(canonical.sort());
  });

  it('every key is a manifest object', () => {
    const orphans = Object.keys(BOXSPECS).filter((n) => !(n in MANIFEST));
    expect(orphans).toEqual([]);
  });

  it('marks exactly the web-only supplement, and keeps the manifest schema unchanged', () => {
    // scripts/gen-manifest.mjs's SUPPLEMENT: what the engine plays that OBJ_INFO lacks.
    const specs = BOXSPECS as Record<string, BoxSpec & { webOnly?: boolean; webAliases?: string[] }>;
    expect(Object.keys(specs).filter((n) => specs[n].webOnly)).toEqual(['live.gain~']);
    expect(Object.keys(specs).filter((n) => specs[n].webAliases)).toEqual(['patcher']);
    expect(specs.patcher.webAliases).toEqual(['p']);
    expect(MANIFEST.p.aliasOf).toBe('patcher');
    const keys = new Set(Object.values(MANIFEST).flatMap((e) => Object.keys(e)));
    expect([...keys].sort()).toEqual(
      ['aliasOf', 'aliases', 'args', 'maxclass', 'numInlets', 'numOutlets', 'outletDomains', 'pkg'],
    );
  });

  it('carries arity rules for exactly the 46 argument-dependent objects', () => {
    const withIo = Object.keys(BOXSPECS).filter((n) => BOXSPECS[n].io !== undefined);
    expect(withIo.length).toBe(46);
    // the objects the patcher's io-rules port must handle
    expect(withIo).toContain('trigger');
    expect(withIo).toContain('unpack');
    expect(withIo).toContain('vst~');
    expect(withIo).toContain('jit.unpack');
    // an empty "in/out" must be dropped, not stored as {}
    expect(BOXSPECS['cycle~'].io).toBeUndefined();
  });

  it('preserves the arity rule payload verbatim', () => {
    expect(BOXSPECS['unpack'].io!.numoutlets[0]).toEqual({
      argtype: 'a',
      index: 'all',
      type: 'unpack_out',
    });
  });

  it('keeps the default box dict, minus the scrape-time id', () => {
    expect(BOXSPECS['cycle~'].box.outlettype).toEqual(['signal']);
    expect(BOXSPECS['cycle~'].box.maxclass).toBe('newobj');
    expect(BOXSPECS['cycle~'].box.text).toBe('cycle~');
    const withId = Object.keys(BOXSPECS).filter((n) => 'id' in BOXSPECS[n].box);
    expect(withId).toEqual([]);
  });

  it('agrees with the manifest on inlet/outlet counts', () => {
    const mismatched = Object.keys(BOXSPECS).filter((n) => {
      const box = BOXSPECS[n].box;
      return box.numinlets !== MANIFEST[n].numInlets || box.numoutlets !== MANIFEST[n].numOutlets;
    });
    expect(mismatched).toEqual([]);
  });

  it('drops the COMMON attribute separator and keeps real attributes', () => {
    const withCommon = Object.keys(BOXSPECS).filter((n) =>
      BOXSPECS[n].attribs.some((a) => a.name === 'COMMON')
    );
    expect(withCommon).toEqual([]);
    expect(BOXSPECS['cycle~'].attribs).toContainEqual({
      name: 'frequency',
      type: 'float',
      size: '1',
    });
  });
});

describe('objdocs.json', () => {
  it('documents most of the object set', () => {
    expect(Object.keys(OBJDOCS).length).toBeGreaterThanOrEqual(600);
  });

  it('every key is a manifest object', () => {
    const orphans = Object.keys(OBJDOCS).filter((n) => !(n in MANIFEST));
    expect(orphans).toEqual([]);
  });

  it('never documents more xlets than the box has, outside the known divergences', () => {
    const inlet: string[] = [];
    const outlet: string[] = [];
    for (const [name, doc] of Object.entries(OBJDOCS)) {
      const entry = MANIFEST[name];
      if (doc.inlets.length > entry.numInlets) {
        inlet.push(`${name} ${doc.inlets.length}>${entry.numInlets}`);
      }
      if (doc.outlets.length > entry.numOutlets) {
        outlet.push(`${name} ${doc.outlets.length}>${entry.numOutlets}`);
      }
    }
    expect(inlet.sort()).toEqual([...KNOWN_INLET_DIVERGENCES].sort());
    expect(outlet.sort()).toEqual([...KNOWN_OUTLET_DIVERGENCES].sort());
  });

  it('numbers xlets densely from 0', () => {
    const bad: string[] = [];
    for (const [name, doc] of Object.entries(OBJDOCS)) {
      for (const [side, xlets] of [
        ['inlets', doc.inlets],
        ['outlets', doc.outlets],
      ] as const) {
        if (xlets.some((x, i) => x.index !== i)) bad.push(`${name}.${side}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('is the inlet-domain source the manifest lacks', () => {
    // MANIFEST has outletDomains only; cord validation needs the other end.
    const bad = Object.keys(OBJDOCS).filter(
      (n) =>
        OBJDOCS[n].inletDomains.length !== OBJDOCS[n].inlets.length ||
        OBJDOCS[n].inletDomains.some((d) => !['signal', 'control', 'video'].includes(d))
    );
    expect(bad).toEqual([]);

    expect(OBJDOCS['cycle~'].inletDomains).toEqual(['signal', 'signal']);
    // INLET_TYPE is the docs' placeholder for a plain message inlet
    expect(OBJDOCS['trigger'].inlets[0].type).toBe('INLET_TYPE');
    expect(OBJDOCS['trigger'].inletDomains).toEqual(['control']);
    expect(OBJDOCS['jit.matrix'].inletDomains).toEqual(['video']);
  });

  it('is keyed by canonical name, reachable from every alias', () => {
    // `*~` is an alias of `times~`; callers resolve through MANIFEST[name].aliasOf
    // rather than us storing 50 duplicate copies.
    expect(OBJDOCS['*~']).toBeUndefined();
    expect(MANIFEST['*~'].aliasOf).toBe('times~');
    expect(OBJDOCS['times~'].inletDomains).toEqual(['signal', 'signal']);

    const unreachable = Object.keys(MANIFEST)
      .map((n) => MANIFEST[n].aliasOf)
      .filter((canonical): canonical is string => !!canonical && !(canonical in OBJDOCS));
    expect(unreachable).toEqual([]);
  });

  it('parses prose sections rather than leaving raw docstring text', () => {
    const cycle = OBJDOCS['cycle~'];
    expect(cycle.digest).toBe('Sinusoidal oscillator');
    expect(cycle.description).toMatch(/^Use the cycle~ object to generate a periodic waveform\./);
    expect(cycle.inlets[0]).toEqual({ index: 0, type: 'signal/float', text: 'Frequency' });
    expect(cycle.outlets).toEqual([{ index: 0, type: 'signal', text: 'Output' }]);
    expect(cycle.messages).toEqual(['float', '(mouse)', 'reset', 'set', 'setall', 'signal']);
    expect(cycle.attributes).toContain('frequency');
    // no section header may survive into a parsed field
    const leaked = Object.keys(OBJDOCS).filter((n) =>
      /^(Inlets|Outlets|Messages|Attributes|Args):/m.test(OBJDOCS[n].description)
    );
    expect(leaked).toEqual([]);
  });

  it('strips the type echo the reference prose repeats in the text', () => {
    // source line: "  2 (signal/float): (signal/float) Starting Table Location in ms"
    const wave = OBJDOCS['2d.wave~'];
    expect(wave.inlets[2]).toEqual({
      index: 2,
      type: 'signal/float',
      text: 'Starting Table Location in ms',
    });
    const echoed = Object.keys(OBJDOCS).filter((n) =>
      [...OBJDOCS[n].inlets, ...OBJDOCS[n].outlets].some((x) =>
        x.text.toLowerCase().startsWith(`(${x.type.toLowerCase()})`)
      )
    );
    expect(echoed).toEqual([]);
  });

  it('attaches each docstring to the object it names, in both file layouts', () => {
    // max.py writes the docstring BEFORE `x = MaxObject('x')`, msp.py/jit.py after;
    // an off-by-one in attachment would show up as digests describing the neighbour.
    expect(OBJDOCS['accum'].digest).toBe('Store, add to, and multiply a number');
    expect(OBJDOCS['absolutepath'].digest).toBe('Convert a file name to an absolute path');
    expect(OBJDOCS['abs~'].digest).toBe('Absolute value of a signal');
    expect(OBJDOCS['jit.matrix'].digest).toBe('The Jitter Matrix!');
  });
});
