// The dict family against Max's own reference pages (dict*.maxref.xml) and help
// patchers: real inlet/outlet indexes, and dictionaries passed as `dictionary <name>`.
import { describe, expect, it } from 'vitest';
import '../../src/objects/control/dict';
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';
import type { IRNode } from '../../src/ir/types';

const ctx = {} as BaseAudioContext;
const bang: Msg = ['bang'];

/** Build an object; `attrs` arrive the way the engine hands them over (node.attrs). */
function build(className: string, args: (number | string)[] = [], attrs?: Record<string, string[]>) {
  const node = attrs ? ({ attrs } as unknown as IRNode) : undefined;
  const obj = getFactory(className)!(args, { ctx, node });
  const out: { outlet: number; m: Msg }[] = [];
  for (let i = 0; i < 8; i++) obj.onControlOut?.(i, (m) => out.push({ outlet: i, m }));
  const send = (m: Msg, inlet = 0) => obj.controlIns?.[inlet]?.(m);
  const on = (outlet: number) => out.filter((e) => e.outlet === outlet).map((e) => e.m);
  return { obj, out, send, on };
}

/** Every `key value…` pair of a dictionary, read back through dict.iter. */
function contents(ref: Msg): Msg[] {
  const it = build('dict.iter');
  it.send(ref);
  return it.on(0);
}

describe('dict', () => {
  it('has 2 inlets; bang sends `dictionary <name>` from outlet 0', () => {
    const d = build('dict', ['mx_a']);
    expect(d.obj.controlIns).toHaveLength(2);
    d.send(bang);
    expect(d.out).toEqual([{ outlet: 0, m: ['dictionary', 'mx_a'] }]);
  });

  it('get answers `key value…` from outlet 1', () => {
    const d = build('dict', ['mx_b']);
    d.send(['set', 'freq', 440]);
    d.send(['set', 'pt', 1, 2, 3]);
    d.send(['get', 'freq']);
    d.send(['get', 'pt']);
    d.send(['get', 'missing']);
    expect(d.out).toEqual([
      { outlet: 1, m: ['freq', 440] },
      { outlet: 1, m: ['pt', 1, 2, 3] },
    ]);
  });

  it('getkeys and contains answer from outlet 2, getnames from outlet 3', () => {
    const d = build('dict', ['mx_c']);
    d.send(['set', 'b', 1]);
    d.send(['set', 'a', 2]);
    d.send(['getkeys']);
    d.send(['contains', 'a']);
    d.send(['contains', 'z']);
    expect(d.on(2)).toEqual([['b', 'a'], [1], [0]]);
    d.send(['getnames']);
    expect(d.on(3)[0]).toContain('mx_c');
  });

  it('getsize and gettype answer `key …` from outlet 1', () => {
    const d = build('dict', ['mx_d']);
    d.send(['set', 'cogs', 11, 13, 15]);
    d.send(['set', 'f', 0.5]);
    d.send(['set', 'n', 3]);
    d.send(['set', 's', 'hi']);
    d.send(['getsize', 'cogs']);
    d.send(['gettype', 'cogs']);
    d.send(['gettype', 'f']);
    d.send(['gettype', 'n']);
    d.send(['gettype', 's']);
    expect(d.on(1)).toEqual([['cogs', 3], ['cogs', 'array'], ['f', 'float'], ['n', 'int'], ['s', 'string']]);
  });

  it('append, replace, remove and clear edit the content', () => {
    const d = build('dict', ['mx_e']);
    d.send(['set', 'k', 1]);
    d.send(['append', 'k', 2, 3]);
    d.send(['get', 'k']);
    d.send(['replace', 'k', 9]);
    d.send(['get', 'k']);
    d.send(['remove', 'k']);
    d.send(['contains', 'k']);
    d.send(['set', 'x', 1]);
    d.send(['clear']);
    d.send(['getkeys']);
    expect(d.on(1)).toEqual([['k', 1, 2, 3], ['k', 9]]);
    expect(d.on(2)).toEqual([[0]]);
  });

  it('`::` keys reach into nested dictionaries', () => {
    const d = build('dict', ['mx_f']);
    d.send(['set', 'wheels::front::spokecount', 24]);
    d.send(['get', 'wheels::front::spokecount']);
    d.send(['gettype', 'wheels']);
    expect(d.on(1)).toEqual([['wheels::front::spokecount', 24], ['wheels', 'dictionary']]);
  });

  it('two dict boxes with one name share one dictionary', () => {
    const a = build('dict', ['mx_twin']);
    const b = build('dict', ['mx_twin']);
    a.send(['set', 'x', 7]);
    b.send(['get', 'x']);
    expect(b.on(1)).toEqual([['x', 7]]);
  });

  it('a dictionary at the left inlet is cloned and sent; at the right inlet only cloned', () => {
    const src = build('dict', ['mx_src']);
    src.send(['set', 'a', 1]);
    const left = build('dict', ['mx_left']);
    left.send(['dictionary', 'mx_src']);
    expect(left.on(0)).toEqual([['dictionary', 'mx_left']]);
    const right = build('dict', ['mx_right']);
    right.send(['dictionary', 'mx_src'], 1);
    expect(right.out).toEqual([]);
    right.send(['get', 'a']);
    expect(right.on(1)).toEqual([['a', 1]]);
    // a clone: later edits to the source do not reach it
    src.send(['set', 'a', 2]);
    right.send(['get', 'a']);
    expect(right.on(1)).toEqual([['a', 1], ['a', 1]]);
  });

  it('parse replaces the content from JSON or dictionary syntax', () => {
    const d = build('dict', ['mx_g']);
    d.send(['parse', '{"x": 1, "y": [2, 3]}']);
    expect(contents(['dictionary', 'mx_g'])).toEqual([['x', 1], ['y', 2, 3]]);
    d.send(['parse', 'cow:', 'moo', 'n', ':', 4]);
    expect(contents(['dictionary', 'mx_g'])).toEqual([['cow', 'moo'], ['n', 4]]);
  });

  it('file messages report failure from outlet 4 (no files in the browser)', () => {
    const d = build('dict', ['mx_h']);
    d.send(['read', 'x.json']);
    expect(d.on(4)).toEqual([['read', 'x.json', 0]]);
  });

  it('a dict without a name gets a generated one', () => {
    const d = build('dict');
    d.send(bang);
    expect(d.on(0)[0][0]).toBe('dictionary');
    expect(String(d.on(0)[0][1])).toMatch(/^u\d+$/);
  });
});

describe('dict.pack', () => {
  it('has one inlet per key plus the unmatched inlet', () => {
    expect(build('dict.pack', ['freq:', 'amp:']).obj.controlIns).toHaveLength(3);
    expect(build('dict.pack', ['cow', ':', 'moo', 'lion', ':', 'roar', 5, 'times']).obj.controlIns).toHaveLength(3);
  });

  it('the left inlet sets its key and sends; other inlets only set (like pack)', () => {
    const p = build('dict.pack', ['freq:', 'amp:']);
    p.send([0.2], 1);
    expect(p.out).toEqual([]);
    p.send([440], 0);
    expect(p.on(0)).toHaveLength(1);
    expect(contents(p.on(0)[0])).toEqual([['freq', 440], ['amp', 0.2]]);
  });

  it('bang at any inlet sends; values default from the arguments', () => {
    const p = build('dict.pack', ['cow', ':', 'moo', 'lion', ':', 'roar', 5, 'times', 'noah', ':', 1]);
    p.send(bang, 2);
    expect(contents(p.on(0)[0])).toEqual([['cow', 'moo'], ['lion', 'roar', 5, 'times'], ['noah', 1]]);
  });

  it('`key:value` in one atom and @name', () => {
    const p = build('dict.pack', ['frog:4'], { name: ['mx_pk'] });
    p.send(bang);
    expect(p.on(0)).toEqual([['dictionary', 'mx_pk']]);
    expect(contents(['dictionary', 'mx_pk'])).toEqual([['frog', 4]]);
  });

  it('@triggers -1 makes every inlet send', () => {
    const p = build('dict.pack', ['a:', 'b:'], { triggers: ['-1'] });
    p.send([5], 1);
    expect(p.on(0)).toHaveLength(1);
    expect(contents(p.on(0)[0])).toEqual([['a', 0], ['b', 5]]);
  });

  it('a symbol message becomes the value; a dictionary is stored as a reference', () => {
    const p = build('dict.pack', ['cow:', 'sub:']);
    p.send(['dictionary', 'mx_other'], 1);
    p.send(['moo']);
    expect(contents(p.on(0)[0])).toEqual([['cow', 'moo'], ['sub', 'dictionary', 'mx_other']]);
  });

  it('the unmatched inlet takes `key value…` for keys without an inlet', () => {
    const p = build('dict.pack', ['a:']);
    p.send(['extra', 1, 2], 1);
    p.send([3]);
    expect(contents(p.on(0)[0])).toEqual([['a', 3], ['extra', 1, 2]]);
  });
});

describe('dict.unpack', () => {
  it('sends each key value from its own outlet, right to left; the rest from the last outlet', () => {
    const p = build('dict.pack', ['freq:', 440, 'amp:', 0.2, 'other:', 'x']);
    p.send(bang);
    const u = build('dict.unpack', ['freq:', 'amp:']);
    expect(u.obj.controlIns).toHaveLength(1);
    u.send(p.on(0)[0]);
    expect(u.out.map((e) => e.outlet)).toEqual([2, 1, 0]);
    expect(u.on(0)).toEqual([[440]]);
    expect(u.on(1)).toEqual([[0.2]]);
    expect(contents(u.on(2)[0])).toEqual([['other', 'x']]);
  });

  it('skips keys the dictionary lacks, and a bang re-reads the last dictionary', () => {
    const d = build('dict', ['mx_u']);
    d.send(['set', 'b', 2]);
    const u = build('dict.unpack', ['a:', 'b:']);
    u.send(['dictionary', 'mx_u']);
    d.send(['set', 'b', 3]);
    u.send(bang);
    expect(u.on(0)).toEqual([]);
    expect(u.on(1)).toEqual([[2], [3]]);
  });

  it('a first argument that is not a key names the dictionary a bang reads', () => {
    const d = build('dict', ['mx_u2']);
    d.send(['set', 'k', 'v']);
    const u = build('dict.unpack', ['mx_u2', 'k:']);
    u.send(bang);
    expect(u.on(0)).toEqual([['v']]);
  });
});

describe('dict.route', () => {
  it('passes a dictionary left when it matches the reference, right otherwise', () => {
    const r = build('dict.route', ['frog:', 4]);
    const yes = build('dict.pack', ['frog:', 4]);
    const no = build('dict.pack', ['frog:', 5]);
    yes.send(bang);
    no.send(bang);
    r.send(yes.on(0)[0]);
    r.send(no.on(0)[0]);
    expect(r.out).toEqual([
      { outlet: 0, m: yes.on(0)[0] },
      { outlet: 1, m: no.on(0)[0] },
    ]);
  });

  it('the right inlet sets the reference dictionary', () => {
    const r = build('dict.route');
    const ref = build('dict', ['mx_rref']);
    ref.send(['set', 'mood', 'happy']);
    r.send(['dictionary', 'mx_rref'], 1);
    const a = build('dict', ['mx_r1']);
    a.send(['set', 'mood', 'happy']);
    a.send(['set', 'x', 1]);
    const b = build('dict', ['mx_r2']);
    b.send(['set', 'x', 1]);
    r.send(['dictionary', 'mx_r1']);
    r.send(['dictionary', 'mx_r2']);
    expect(r.out).toEqual([
      { outlet: 0, m: ['dictionary', 'mx_r1'] },
      { outlet: 1, m: ['dictionary', 'mx_r2'] },
    ]);
  });
});

describe('dict.iter', () => {
  it('sends `key value…` for each entry', () => {
    const d = build('dict', ['mx_it']);
    d.send(['set', 'a', 1]);
    d.send(['set', 'b', 2, 3]);
    const it = build('dict.iter');
    it.send(['dictionary', 'mx_it']);
    expect(it.on(0)).toEqual([['a', 1], ['b', 2, 3]]);
  });
});

describe('dict.join', () => {
  it('joins the right dictionary onto the left one; the right wins on a shared key', () => {
    const left = build('dict.pack', ['brick', ':', 2, 'wheat', ':', 1]);
    const right = build('dict.pack', ['brick', ':', 5, 'ore', ':', 4]);
    left.send(bang);
    right.send(bang);
    const j = build('dict.join');
    j.send(right.on(0)[0], 1);
    j.send(left.on(0)[0], 0);
    const merged = j.on(0)[0];
    expect(merged[0]).toBe('dictionary');
    expect(contents(merged)).toEqual([['brick', 5], ['wheat', 1], ['ore', 4]]);
    j.send(bang);
    expect(j.on(0)).toEqual([merged, merged]);
  });

  it('arguments give the initial right-hand dictionary', () => {
    const j = build('dict.join', ['frog:', 1]);
    const d = build('dict', ['mx_j']);
    d.send(['set', 'cow', 'moo']);
    j.send(['dictionary', 'mx_j']);
    expect(contents(j.on(0)[0])).toEqual([['cow', 'moo'], ['frog', 1]]);
  });
});

describe('dict.strip', () => {
  it('removes the keys from the dictionary itself, sending them from outlet 1, then the dictionary', () => {
    const d = build('dict', ['mx_st']);
    d.send(['set', 'cow', 'moo', 'moo']);
    d.send(['set', 'sheep', 'baa']);
    d.send(['set', 'dog', 'woof']);
    const s = build('dict.strip', ['cow', 'sheep']);
    s.send(['dictionary', 'mx_st']);
    expect(s.out).toEqual([
      { outlet: 1, m: ['cow', 'moo', 'moo'] },
      { outlet: 1, m: ['sheep', 'baa'] },
      { outlet: 0, m: ['dictionary', 'mx_st'] },
    ]);
    expect(contents(['dictionary', 'mx_st'])).toEqual([['dog', 'woof']]);
  });
});

describe('dict.serialize / dict.deserialize', () => {
  it('serialize sends dictionary syntax by default, JSON with @mode json', () => {
    const d = build('dict', ['mx_ser']);
    d.send(['set', 'freq', 440]);
    d.send(['set', 'pt', 1, 2, 'foo']);
    const s = build('dict.serialize');
    s.send(['dictionary', 'mx_ser']);
    expect(s.on(0)).toEqual([['freq', ':', 440, 'pt', ':', 1, 2, 'foo']]);
    const j = build('dict.serialize', [], { mode: ['json'] });
    j.send(['dictionary', 'mx_ser']);
    expect(JSON.parse(j.on(0)[0][0] as string)).toEqual({ freq: 440, pt: [1, 2, 'foo'] });
  });

  it('deserialize reads dictionary syntax from a plain message', () => {
    const ds = build('dict.deserialize');
    ds.send(['goose', ':', 'honk', 'pig', ':', 0.05, 'horse', ':', 1, 2, 'foo', 3]);
    expect(contents(ds.on(0)[0])).toEqual([['goose', 'honk'], ['pig', 0.05], ['horse', 1, 2, 'foo', 3]]);
    ds.send(['freq:', 440, 'amp:', 0.2]);
    expect(contents(ds.on(0)[1])).toEqual([['freq', 440], ['amp', 0.2]]);
  });

  it('deserialize reads JSON, and round-trips what serialize writes', () => {
    const ds = build('dict.deserialize', ['mx_ds']);
    ds.send(['{"a": 1, "b": {"c": 2}}']);
    expect(ds.on(0)).toEqual([['dictionary', 'mx_ds']]);
    const d = build('dict', ['mx_ds']);
    d.send(['get', 'b::c']);
    expect(d.on(1)).toEqual([['b::c', 2]]);

    const s = build('dict.serialize');
    s.send(['dictionary', 'mx_ds']);
    const back = build('dict.deserialize');
    back.send(s.on(0)[0]);
    const d2 = build('dict');
    d2.send(back.on(0)[0]);
    d2.send(['get', 'b::c']);
    d2.send(['get', 'a']);
    expect(d2.on(1)).toEqual([['b::c', 2], ['a', 1]]);
  });

  it('deserialize ignores input that is neither syntax nor JSON', () => {
    const ds = build('dict.deserialize');
    ds.send(['{not valid']);
    ds.send(['just', 'words']);
    expect(ds.out).toEqual([]);
  });
});
