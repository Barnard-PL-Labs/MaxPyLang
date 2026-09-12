// src/ir/objectspec.ts — box text in, a fully-specified box out.
//
// Two things are being guarded. First that parseBoxText/formatBoxText are genuine
// inverses, because every text edit in the patcher goes out through one and comes back
// through the other, and a lossy pass would quietly rewrite the user's box. Second that
// resolveBox assembles the same object maxpylang would: the right class after alias
// resolution, the right arity from the argument rules, and typed outlets.
//
// The arity rules themselves are proved against real maxpylang output in
// io-rules.test.ts; here they only need to be shown to be wired in.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  boxSpecs,
  formatBoxText,
  loadBoxSpecs,
  objectNames,
  parseBoxText,
  resolveBox,
  setArg,
  setAttrib,
  specToNode,
} from '../src/ir/objectspec';

/**
 * boxspecs.json is generated and committed, but it is not this file's job to fail when a
 * fresh checkout has not run `npm run gen:manifest` yet. Checked on disk rather than by
 * catching the dynamic import, because skipIf is evaluated while tests are collected —
 * long before any beforeAll has had a chance to set a flag.
 */
const specsPresent = existsSync(
  fileURLToPath(new URL('../src/generated/boxspecs.json', import.meta.url)),
);
const itWithSpecs = it.skipIf(!specsPresent);

beforeAll(async () => {
  if (specsPresent) await loadBoxSpecs();
});

describe('parseBoxText', () => {
  it('splits a class name from its arguments', () => {
    expect(parseBoxText('cycle~ 440')).toEqual({
      name: 'cycle~', args: [440], argIsFloat: [false], attrs: {},
    });
    expect(parseBoxText('*~')).toEqual({ name: '*~', args: [], argIsFloat: [], attrs: {} });
    expect(parseBoxText('')).toEqual({ name: '', args: [], argIsFloat: [], attrs: {} });
  });

  it('stops arguments at the first @, and collects multi-value attributes', () => {
    // The bug this replaced: the engine used to receive "@frequency" as argument 0.
    expect(parseBoxText('cycle~ @frequency 440')).toEqual({
      name: 'cycle~',
      args: [],
      argIsFloat: [],
      attrs: { frequency: ['440'] },
    });
    expect(parseBoxText('jit.movie 320 240 @moviefile a.mov @dim 320 240')).toEqual({
      name: 'jit.movie',
      args: [320, 240],
      argIsFloat: [false, false],
      attrs: { moviefile: ['a.mov'], dim: ['320', '240'] },
    });
    expect(parseBoxText('jit.window @floating').attrs).toEqual({ floating: [] });
  });

  it('types numbers the way Python does, and leaves everything else a symbol', () => {
    expect(parseBoxText('t 1 -2 3.5 .5 1e3 i b buf~').args).toEqual([
      1, -2, 3.5, 0.5, 1000, 'i', 'b', 'buf~',
    ]);
    // Number() would make these 16 and Infinity; Python's float() rejects both.
    expect(parseBoxText('foo 0x10 Infinity').args).toEqual(['0x10', 'Infinity']);
  });

  it('collapses runs of whitespace instead of crashing on them', () => {
    // Upstream splits on a single space and then indexes text[i][0], so "a  b" raises.
    expect(parseBoxText('  pack   1   2  ')).toEqual({
      name: 'pack', args: [1, 2], argIsFloat: [false, false], attrs: {},
    });
  });

  it('takes every token as an argument when the class is given from outside', () => {
    expect(parseBoxText('1 2 3', 'message')).toEqual({
      name: 'message',
      args: [1, 2, 3],
      argIsFloat: [false, false, false],
      attrs: {},
    });
  });

  it('leaves @ alone in a UI box — a message box sends it, it is not an attribute', () => {
    // "@gain 0.5" in a message box is a two-atom message. Parsed as an attribute it
    // would leave args empty, and control/index.ts's message factory emits a bang
    // instead of its args when they are empty, so the message would vanish.
    expect(parseBoxText('@gain 0.5', 'message')).toEqual({
      name: 'message',
      args: ['@gain', 0.5],
      argIsFloat: [false, true],
      attrs: {},
    });
    // Same text in an object box is what attribute syntax is actually for.
    expect(parseBoxText('cycle~ @gain 0.5')).toEqual({
      name: 'cycle~',
      args: [],
      argIsFloat: [],
      attrs: { gain: ['0.5'] },
    });
  });
});

describe('formatBoxText', () => {
  it('round-trips object boxes, attributes included', () => {
    for (const text of [
      'cycle~ 440',
      '*~ 0.2',
      'ezdac~',
      't b f',
      'unpack 1 2 3',
      'cycle~ @frequency 440',
      'jit.movie 320 240 @moviefile a.mov @dim 320 240',
      'scale 0 127 0.5 1.5',
      'jit.window @floating',
    ]) {
      expect(formatBoxText(parseBoxText(text))).toBe(text);
    }
  });

  it('round-trips boxes whose class comes from the maxclass, not the text', () => {
    for (const [maxclass, text] of [
      ['message', '1 2 3'],
      ['message', 'set $1'],
      ['comment', 'gain'],
      ['ezdac~', 'ezdac~'], // maxpylang writes the class name into UI box text too
      ['number', 'number'],
    ] as const) {
      expect(formatBoxText(parseBoxText(text, maxclass), maxclass)).toBe(text);
    }
  });

  it('drops the class name of a message box even when the text carries it', () => {
    // get_text's one asymmetry: place("message 1 2") produces a box reading "1 2".
    expect(formatBoxText(parseBoxText('message 1 2'))).toBe('1 2');
  });

  it('normalizes a float argument without turning it into an int', () => {
    // Python has two numeric types where JS has one, and the difference is behavioural:
    // an all-int `scale` outputs ints, so collapsing `0. 1.` to `0 1` would quietly turn
    // a 0-to-1 float mapping into a 0-or-1 int one. maxpylang (verified against .venv)
    // answers each of these exactly as asserted here.
    expect(formatBoxText(parseBoxText('scale 0 127 0. 1.'))).toBe('scale 0 127 0.0 1.0');
    expect(formatBoxText(parseBoxText('scale 0.0 1.0 150 900'))).toBe('scale 0.0 1.0 150 900');
    expect(formatBoxText(parseBoxText('pack 0. 0.'))).toBe('pack 0.0 0.0');
    // Normalization still happens — both sides round-trip through the number itself.
    expect(formatBoxText(parseBoxText('pack 0.50'))).toBe('pack 0.5');
    expect(formatBoxText(parseBoxText('t 1e3'))).toBe('t 1000.0');
    // An int stays an int, and a symbol is never given a fraction.
    expect(formatBoxText(parseBoxText('pack 0 0'))).toBe('pack 0 0');
    expect(formatBoxText(parseBoxText('pack f f'))).toBe('pack f f');
  });

  it('marks exactly the float arguments, so an editor can keep them float', () => {
    expect(parseBoxText('scale 0 127 0. 1.').argIsFloat).toEqual([false, false, true, true]);
    expect(parseBoxText('t 1 -2 3.5 .5 1e3 i').argIsFloat).toEqual([
      false, false, true, true, true, false,
    ]);
  });

  it('survives every box in the bundled patch corpus without further drift', () => {
    const dir = fileURLToPath(new URL('../public/test-patches/', import.meta.url));
    let boxes = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.maxpat'))) {
      const patch = JSON.parse(readFileSync(dir + file, 'utf-8'));
      for (const entry of patch.patcher.boxes) {
        const box = entry.box;
        const maxclass: string = box.maxclass ?? 'newobj';
        const asUi = maxclass === 'newobj' ? undefined : maxclass;
        const once = parseBoxText(box.text ?? '', asUi);
        const text = formatBoxText(once, asUi);
        // One normalization pass at most: reparsing the formatted text must give back
        // exactly the same parse, or an edit-save-edit cycle would keep mutating the box.
        expect(parseBoxText(text, asUi), `${file}: ${box.text}`).toEqual(once);
        boxes++;
      }
    }
    expect(boxes).toBeGreaterThan(100);
  });
});

describe('setArg / setAttrib', () => {
  const base = parseBoxText('scale 0 127 0 1');

  it('replaces one positional argument', () => {
    expect(formatBoxText(setArg(base, 2, 0.5))).toBe('scale 0 127 0.5 1');
    expect(formatBoxText(setArg(base, 3, 0.5))).toBe('scale 0 127 0 0.5');
  });

  it('appends past the end rather than leaving a hole', () => {
    // Max arguments are positional with no way to skip one, so "set #9" means "append".
    expect(formatBoxText(setArg(base, 9, 'x'))).toBe('scale 0 127 0 1 x');
  });

  it('deletes on null and shifts the rest down', () => {
    expect(formatBoxText(setArg(base, 0, null))).toBe('scale 127 0 1');
  });

  it('adds, replaces and deletes attributes', () => {
    const withAttr = setAttrib(base, 'classic', '1');
    expect(formatBoxText(withAttr)).toBe('scale 0 127 0 1 @classic 1');
    expect(formatBoxText(setAttrib(withAttr, 'classic', ['1', '2']))).toBe(
      'scale 0 127 0 1 @classic 1 2',
    );
    expect(formatBoxText(setAttrib(withAttr, 'classic', null))).toBe('scale 0 127 0 1');
  });

  it('keeps a float argument float when its value is replaced', () => {
    // Editing one end of `scale 0 127 0. 1.` in the inspector must not retype the whole
    // range as ints — an all-int scale outputs ints, which is a different object.
    const floats = parseBoxText('scale 0 127 0. 1.');
    expect(formatBoxText(setArg(floats, 3, 2))).toBe('scale 0 127 0.0 2.0');
    expect(formatBoxText(setArg(floats, 0, 5))).toBe('scale 5 127 0.0 1.0');
    // A NEW argument is a float only if it carries a fraction: JS cannot tell 1.0 from 1.
    expect(formatBoxText(setArg(floats, 9, 0.25))).toBe('scale 0 127 0.0 1.0 0.25');
    expect(formatBoxText(setArg(floats, 9, 3))).toBe('scale 0 127 0.0 1.0 3');
    // Deleting shifts the flags along with the args they belong to.
    expect(formatBoxText(setArg(floats, 2, null))).toBe('scale 0 127 1.0');
  });

  it('never mutates the input', () => {
    setArg(base, 0, 99);
    setAttrib(base, 'classic', '1');
    expect(formatBoxText(base)).toBe('scale 0 127 0 1');

    const floats = parseBoxText('pack 0. 0.');
    setArg(floats, 0, 1);
    expect(formatBoxText(floats)).toBe('pack 0.0 0.0');
  });
});

describe('resolveBox', () => {
  itWithSpecs('applies the argument-dependent arity rules', () => {
    expect(resolveBox('unpack 1 2 3').numOutlets).toBe(3);
    expect(resolveBox('unpack').numOutlets).toBe(2); // the args == [] early return
    expect(resolveBox('pack 1 2 3 4').numInlets).toBe(4);
    expect(resolveBox('mc.matrix~ 4 4').numOutlets).toBe(6);
  });

  itWithSpecs('types trigger outlets, which upstream leaves blank', () => {
    const spec = resolveBox('t b f');
    expect(spec.numOutlets).toBe(2);
    expect(spec.outletTypes).toEqual(['bang', 'float']);
    expect(spec.outletDomains).toEqual(['control', 'control']);
  });

  itWithSpecs('colours outlets by domain from their type token', () => {
    expect(resolveBox('cycle~ 440').outletDomains).toEqual(['signal']);
    expect(resolveBox('mc.unpack~ 3').outletDomains).toEqual(['signal', 'signal', 'signal']);
    expect(resolveBox('jit.unpack 3').outletDomains).toEqual([
      'video', 'video', 'video', 'control',
    ]);
  });

  itWithSpecs('resolves an alias to the canonical object spec', () => {
    const alias = resolveBox('t b f');
    const canonical = resolveBox('trigger b f');
    expect(alias.canonical).toBe('trigger');
    expect(canonical.canonical).toBe('trigger');
    expect(alias.name).toBe('t'); // the text keeps what was typed
    expect(alias.numOutlets).toBe(canonical.numOutlets);
    expect(alias.outletTypes).toEqual(canonical.outletTypes);
    expect(resolveBox('sel 1 2').canonical).toBe('select');
    expect(resolveBox('b 3').canonical).toBe('bangbang');
  });

  it('mirrors unknown_obj_dict for a name no object has', () => {
    const spec = resolveBox('zzz.not.an.object 1 2');
    expect(spec.known).toBe(false);
    expect(spec.numInlets).toBe(0);
    expect(spec.numOutlets).toBe(0);
    expect(spec.outletDomains).toEqual([]);
    expect(spec.warnings[0]).toMatch(/unknown/i);
    // The text is still kept, so the box can be fixed by typing rather than retyped.
    expect(spec.text).toBe('zzz.not.an.object 1 2');
    expect(spec.args).toEqual([1, 2]);
  });

  itWithSpecs('warns about a bad argument signature instead of gutting the box', () => {
    // maxpylang answers both of these with unknown_obj_dict — 0 in, 0 out, no behaviour.
    const missing = resolveBox('select');
    expect(missing.known).toBe(true);
    expect(missing.numOutlets).toBe(2);
    expect(missing.warnings.join(' ')).toMatch(/missing required argument/);

    const badType = resolveBox('select foo');
    expect(badType.known).toBe(true);
    expect(badType.warnings.join(' ')).toMatch(/should be int/);

    expect(resolveBox('select 1 2').warnings).toEqual([]);
  });

  itWithSpecs('sizes an object box from its text and a UI box from its own default', () => {
    const short = resolveBox('t b', [10, 20]);
    const long = resolveBox('unpack 1 2 3 4 5', [10, 20]);
    expect(short.rect.slice(0, 2)).toEqual([10, 20]);
    expect(short.rect[3]).toBe(22);
    expect(long.rect[2]).toBeGreaterThan(short.rect[2]);

    const toggle = resolveBox('toggle', [10, 20]);
    expect(toggle.maxclass).toBe('toggle');
    const defaultRect = boxSpecs()!['toggle'].box.patching_rect as number[];
    expect(toggle.rect.slice(2)).toEqual(defaultRect.slice(2));
  });

  it('reads a UI box past its class name as content, never as attributes', () => {
    // parseBoxText's className parameter exists for exactly this case, and resolveBox has
    // to apply it AFTER the lookup that needed the class name in front. Read as an
    // attribute, `@interp 1` would leave the box with no args at all — and the engine's
    // message factory emits a bare bang when its args are empty.
    const msg = resolveBox('message @interp 1');
    expect(msg.maxclass).toBe('message');
    expect(msg.args).toEqual(['@interp', 1]);
    expect(msg.attrs).toEqual({});
    expect(specToNode(msg, 'obj-1').args).toEqual(['@interp', 1]);

    expect(resolveBox('comment ping @ 3pm').args).toEqual(['ping', '@', '3pm']);
    // Unchanged where there is no `@`, and unchanged for object boxes, where attribute
    // syntax is what `@` actually means.
    expect(resolveBox('message 1 2').args).toEqual([1, 2]);
    expect(resolveBox('toggle').args).toEqual([]);
    expect(resolveBox('cycle~ @frequency 440').attrs).toEqual({ frequency: ['440'] });
    expect(resolveBox('cycle~ @frequency 440').args).toEqual([]);
  });

  itWithSpecs('writes vst~ arguments into the save list Max restores the plugin from', () => {
    // maxpylang's update_vst. Max reads a vst~'s channel count and plugin from `save`,
    // never from the box text, so a box saved without this reopens as an empty 8-outlet
    // vst~ with no plugin and no error.
    expect(resolveBox('vst~ 2 MyPlugin.vst3').box.save).toEqual([
      '#N', 'vst~', 'loaduniqueid', 0, 2, 'MyPlugin.vst3', ';',
    ]);
    // A bare vst~ keeps the stock list: upstream returns before update_vst with no args.
    expect(resolveBox('vst~').box.save).toEqual(['#N', 'vst~', 'loaduniqueid', 0, ';']);
    // The spread in resolveBox is shallow, so the list must be replaced and never
    // mutated: otherwise the shared boxspecs table would grow an argument per vst~ built.
    expect(boxSpecs()!['vst~'].box.save).toEqual(['#N', 'vst~', 'loaduniqueid', 0, ';']);
    expect(resolveBox('vst~ 4 Other.vst3').box.save).toEqual([
      '#N', 'vst~', 'loaduniqueid', 0, 4, 'Other.vst3', ';',
    ]);
    // mc.vst~ is its own object upstream and has no save list to rewrite.
    expect(resolveBox('mc.vst~ 2 plug.vst').box.save).toBeUndefined();
  });

  itWithSpecs('never applies an arity rule to a UI class', () => {
    // resolveBox reads the arity rules for newobj boxes only; assert the corpus agrees.
    const specs = boxSpecs()!;
    const uiWithRules = Object.keys(specs).filter(
      (name) => specs[name].io && specs[name].box.maxclass !== 'newobj',
    );
    expect(uiWithRules).toEqual([]);
  });

  it('falls back to the manifest when boxspecs have not loaded', async () => {
    vi.resetModules();
    const fresh = await import('../src/ir/objectspec');
    expect(fresh.boxSpecs()).toBeUndefined();
    const spec = fresh.resolveBox('unpack 1 2 3');
    // No rules available, so the default arity — but class, domains and text are right.
    expect(spec.numOutlets).toBe(2);
    expect(spec.known).toBe(true);
    expect(spec.maxclass).toBe('newobj');
    expect(fresh.resolveBox('cycle~ 440').outletDomains).toEqual(['signal']);
    expect(await fresh.loadBoxSpecs()).toBe(await fresh.loadBoxSpecs());
  });
});

describe('specToNode', () => {
  itWithSpecs('carries the resolved box into a graph node', () => {
    const node = specToNode(resolveBox('t b f', [40, 60]), 'obj-7');
    expect(node).toEqual({
      id: 'obj-7',
      className: 't',
      args: ['b', 'f'],
      maxclass: 'newobj',
      numInlets: 1,
      numOutlets: 2,
      outletDomains: ['control', 'control'],
      rect: [40, 60, expect.any(Number), 22],
      text: 't b f',
      outletTypes: ['bang', 'float'],
      attrs: {},
      known: true,
    });
  });
});

describe('objectNames', () => {
  it('lists every manifest entry, aliases included', () => {
    const names = objectNames();
    expect(names.length).toBeGreaterThan(1000);
    expect(names).toContain('cycle~');
    expect(names).toContain('t');
    expect(new Set(names).size).toBe(names.length);
  });
});
