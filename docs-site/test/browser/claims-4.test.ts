// Group 4 claims: every example's title and note, held to what the patch really does.
// Each test quotes the claim it checks. Known bugs are it.fails('BUG: ...').
import { describe, expect, it, vi } from 'vitest';
import '../../../web/src/objects';
import { Engine } from '../../../web/src/engine/engine';
import { parseMaxPat } from '../../../web/src/parser/maxpat';
import { preloadWorklets } from '../../../web/src/runtime/worklet';
import { loadClip, playTrack } from '../../src/player';
import { SR, example, boxIds, pitch, rms, peak, firsts } from './helpers/measure';

type Atom = number | string;
interface Heard { t: number; seq: number; msg: Atom[] }
interface Listen { box: string; outlet?: number; nth?: number; label?: string }
/** At audio time `at` (s), send `msg` into a box's inlet, as a click or typed number would. */
interface Act { at: number; box: string; nth?: number; inlet?: number; msg: Atom[] }
interface R { left: Float32Array; right: Float32Array; heard: Record<string, Heard[]> }

const STEP = 0.01;
const realSetTimeout = globalThis.setTimeout.bind(globalThis);

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The helper's run(), plus: a global order number on every message heard (so order across
 * boxes can be checked) and `acts`, messages sent into boxes mid-render (clicks, typing).
 */
async function render(object: string, index = 0, opts: { seconds?: number; listen?: Listen[]; acts?: Act[]; seed?: number; edit?: (p: any) => void } = {}): Promise<R> {
  const ex0 = example(object, index);
  const ex = { ...ex0, patch: JSON.parse(JSON.stringify(ex0.patch)) };
  opts.edit?.(ex.patch);
  const seconds = opts.seconds ?? 2.5;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  const rand = vi.spyOn(Math, 'random').mockImplementation(seeded(opts.seed ?? 1));
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const engine = new Engine(ctx);
  try {
    await preloadWorklets(ctx);
    engine.build(parseMaxPat(ex.patch));
    const nodes = (engine as unknown as { nodes: Map<string, any> }).nodes;
    let now = 0, seq = 0;
    const heard: Record<string, Heard[]> = {};
    const idOf = (box: string, nth = 0) => {
      const id = boxIds(ex, box)[nth];
      if (!id) throw new Error(`${object}/${index} has no box "${box}" #${nth}`);
      return id;
    };
    for (const l of opts.listen ?? []) {
      const label = l.label ?? l.box;
      heard[label] = [];
      nodes.get(idOf(l.box, l.nth))?.onControlOut?.(l.outlet ?? 0, (m: Atom[]) => heard[label].push({ t: now, seq: seq++, msg: [...m] }));
    }
    const names = ex.patch.patcher.boxes.map((b: any) => (b.box.text ?? b.box.maxclass).split(' ')[0]);
    if (names.includes('plugin~')) playTrack(ctx, await loadClip(ctx));
    await engine.start();
    const acts = [...(opts.acts ?? [])].sort((a, b) => a.at - b.at);
    for (let t = STEP; t < seconds; t += STEP) {
      const at = Math.round((t * SR) / 128) * 128 / SR;
      if (at >= ctx.length / SR) break;
      void ctx.suspend(at).then(async () => {
        now = at;
        vi.advanceTimersByTime(STEP * 1000);
        while (acts.length && acts[0].at <= at + 1e-9) {
          const a = acts.shift()!;
          nodes.get(idOf(a.box, a.nth)).controlIns[a.inlet ?? 0](a.msg);
        }
        void ctx.resume();
      });
    }
    const buffer = await ctx.startRendering();
    return { left: buffer.getChannelData(0).slice(), right: buffer.getChannelData(1).slice(), heard };
  } finally {
    await engine.stop();
    engine.clear();
    rand.mockRestore();
    vi.useRealTimers();
  }
}
void realSetTimeout;

/** A patch edit: replace a box by "*~ 1." (a wire), keeping the cords into inlet 0 and out of `outlet`. */
const bypass = (text: string, outlet = 0) => (p: any) => {
  const b = p.patcher.boxes.find((x: any) => x.box.text === text).box;
  b.text = '*~ 1.'; b.numinlets = 2; b.numoutlets = 1; b.outlettype = ['signal'];
  p.patcher.lines = p.patcher.lines.filter((l: any) => {
    const { source: s, destination: d } = l.patchline;
    if (d[0] === b.id && d[1] !== 0) return false;
    if (s[0] === b.id) { if (s[1] !== outlet) return false; s[1] = 0; }
    return true;
  });
};

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
/** Amplitude of the component at f Hz between t0 and t1 (Hann window): a sine of amplitude a gives ≈ a. */
function amp(x: Float32Array, t0: number, t1: number, f: number): number {
  const s = x.subarray(Math.round(t0 * SR), Math.round(t1 * SR));
  const n = s.length;
  let re = 0, im = 0, wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const ph = (2 * Math.PI * f * i) / SR;
    re += w * s[i] * Math.cos(ph); im -= w * s[i] * Math.sin(ph);
    wsum += w;
  }
  return (2 * Math.hypot(re, im)) / wsum;
}
const db = (r: number) => 20 * Math.log10(r);
/** Times (s) of messages, rounded to the 10 ms clock grid. */
const times = (h: Heard[]) => h.map((x) => Math.round(x.t * 100) / 100);
const diffs = (a: number[]) => a.slice(1).map((v, i) => Math.round((v - a[i]) * 1000) / 1000);
const within = (h: Heard[], t0: number, t1: number) => h.filter((x) => x.t >= t0 && x.t < t1);

// ─────────────────────────────────────────── Control: numbers and routing ─────────

describe('accum/0: Keep adding', () => {
  it('"Each beat adds 7 semitones, then sends the total: % 12 folds it ... the notes walk the circle of fifths"', async () => {
    const r = await render('accum', 0, { seconds: 1.6, listen: [{ box: 'accum' }, { box: '+ 60' }] });
    expect(firsts(r.heard.accum).slice(0, 5)).toEqual([7, 14, 21, 28, 35]);       // added before it is sent
    expect(firsts(r.heard['+ 60']).slice(0, 5)).toEqual([67, 62, 69, 64, 71]);     // G D A E B: fifths
    expect(diffs(times(r.heard.accum)).slice(0, 4)).toEqual([0.3, 0.3, 0.3, 0.3]); // metro 300
    expect(pitch(r.left, 0.05, 0.25)).toBeCloseTo(mtof(67), -1);
    expect(pitch(r.left, 0.35, 0.55)).toBeCloseTo(mtof(62), -1);
  });
});

describe('bangbang/0: Bangs in a fixed order', () => {
  it('"The right bang picks the note first, then the left bang starts the pluck, so every pluck has its new pitch"', async () => {
    const r = await render('bangbang', 0, { seconds: 1.3, listen: [{ box: 'bangbang', outlet: 0, label: 'L' }, { box: 'bangbang', outlet: 1, label: 'R' }, { box: '+ 60' }, { box: ' 1 5 0 280', label: 'pluck' }] });
    expect(r.heard.L.length).toBe(5);
    for (let i = 0; i < 4; i++) {
      expect(r.heard.R[i].seq).toBeLessThan(r.heard.L[i].seq);                   // right to left
      expect(r.heard['+ 60'][i].seq).toBeLessThan(r.heard.pluck[i].seq);         // note before pluck
      const t = r.heard.pluck[i].t;
      expect(pitch(r.left, t + 0.01, t + 0.15)).toBeCloseTo(mtof(r.heard['+ 60'][i].msg[0] as number), -1);
    }
    // a pluck: up in 5 ms, down to 0 over 280 ms
    expect(rms(r.left, 0.01, 0.04)).toBeGreaterThan(5 * rms(r.left, 0.27, 0.285));
  });
});

describe('bangbang/1: b: flip a coin, then play', () => {
  it('"Its right bang asks decide for a 0 or 1 ... then its left bang sends a random note at the gate. About half the beats, the note doesn\'t change"', async () => {
    const r = await render('bangbang', 1, { seconds: 6.1, listen: [{ box: 'b', outlet: 0, label: 'bL' }, { box: 'b', outlet: 1, label: 'bR' }, { box: 'decide' }, { box: 'random' }, { box: 'gate' }] });
    const coins = r.heard.decide, picks = r.heard.random, passed = r.heard.gate;
    expect(coins.length).toBe(picks.length);
    const L = r.heard.bL, Rb = r.heard.bR;
    for (let i = 0; i < coins.length; i++) {
      expect(Rb[i].seq).toBeLessThan(L[i].seq); // right bang (the coin) first
      // (a listener logs after the box's cords have run, so a box's downstream output logs
      // before the box itself: compare by time, not by order, across boxes)
      const out = passed.find((p) => p.t === picks[i].t);
      if (coins[i].msg[0] === 1) expect(out?.msg[0]).toBe(picks[i].msg[0]);
      else expect(out).toBeUndefined();
    }
    const frac = passed.length / picks.length;
    expect(frac).toBeGreaterThan(0.3);
    expect(frac).toBeLessThan(0.7);
  });
});

describe('change/0: Only new notes start a sound', () => {
  it('"change passes a number only when it differs from the last, so repeats are silent and only new notes are plucked"', async () => {
    const r = await render('change', 0, { seconds: 3, listen: [{ box: 'random' }, { box: 'change' }, { box: ' 1 5 0 250', label: 'pluck' }] });
    const picks = firsts(r.heard.random) as number[];
    const expected: number[] = [];
    let last = 0; // Max: change's initial stored value is 0
    for (const p of picks) { if (p !== last) expected.push(p); last = p; }
    expect(firsts(r.heard.change)).toEqual(expected);
    expect(r.heard.pluck.length).toBe(expected.length);
    expect(expected.length).toBeLessThan(picks.length); // repeats happened and were silent
  });
});

describe('counter/0: Counting up', () => {
  it('"counter outputs 0, 1, 2, 3, 0, ... Times 4 plus 60 plays ... 60, 64, 68, 72"', async () => {
    const r = await render('counter', 0, { seconds: 1.0, listen: [{ box: 'counter' }, { box: '+ 60' }] });
    expect(firsts(r.heard.counter).slice(0, 6)).toEqual([0, 1, 2, 3, 0, 1]);
    expect(firsts(r.heard['+ 60']).slice(0, 5)).toEqual([60, 64, 68, 72, 60]);
    expect(pitch(r.left, 0.2, 0.34)).toBeCloseTo(mtof(64), -1);
    expect(pitch(r.left, 0.56, 0.7)).toBeCloseTo(mtof(72), -1);
  });
});

describe('float/0: Hold a moving value', () => {
  it('"line glides from 200 to 800 Hz over 4 seconds ... A 250 ms metro bangs float ... a staircase of steps"', async () => {
    const r = await render('float', 0, { seconds: 4.05, listen: [{ box: 'line' }, { box: 'float' }] });
    const f = r.heard.float;
    expect(r.heard.line.length).toBeGreaterThan(3 * f.length); // the right inlet only stores
    expect(diffs(times(f)).every((d) => Math.abs(d - 0.25) < 0.011)).toBe(true);
    // each step is the glide's value at that moment: 200 + 600 t / 4
    for (const x of f.filter((x) => x.t > 0.2 && x.t < 3.9)) expect(x.msg[0] as number).toBeCloseTo(200 + 150 * x.t, -1.5);
    expect(pitch(r.left, 2.02, 2.23)).toBeCloseTo(f.find((x) => Math.abs(x.t - 2) < 0.006)!.msg[0] as number, -1);
  });
});

describe('gate/0: Send notes one way or another', () => {
  it('"starts with the first open: random notes go to + 60 ... click the toggle to send the notes up an octave"', async () => {
    const r = await render('gate', 0, { seconds: 2.1, listen: [{ box: '+ 60' }, { box: '+ 72' }, { box: 'random' }], acts: [{ at: 1.1, box: 'toggle', msg: [1] }] });
    const low = r.heard['+ 60'], high = r.heard['+ 72'];
    expect(low.every((x) => x.t < 1.1)).toBe(true);
    expect(low.length).toBe(5);                     // 0, .25, .5, .75, 1.0
    expect(high.every((x) => x.t > 1.1)).toBe(true);
    expect(high.length).toBe(4);
    for (const h of high) expect(h.msg[0]).toBe((r.heard.random.find((x) => x.t === h.t)!.msg[0] as number) + 72);
    expect(pitch(r.left, 0.8, 0.98)).toBeCloseTo(mtof(low[3].msg[0] as number), -1);
    expect(pitch(r.left, 1.8, 1.98)).toBeCloseTo(mtof(high[2].msg[0] as number), -1);
  });
});

describe('gswitch/0: A switch you can see', () => {
  it('"a bang in its left inlet flips it. A slow metro flips it every 2 seconds, between a climbing scale and random notes"', async () => {
    const r = await render('gswitch', 0, { seconds: 4.3, listen: [{ box: 'counter' }, { box: '+ 60' }, { box: 'gswitch' }] });
    const src = (x: Heard) => (r.heard.counter.find((c) => c.t === x.t)?.msg[0] === x.msg[0] ? 'scale' : r.heard['+ 60'].find((c) => c.t === x.t)?.msg[0] === x.msg[0] ? 'random' : '?');
    const a = new Set(within(r.heard.gswitch, 0.1, 1.95).map(src));
    const b = new Set(within(r.heard.gswitch, 2.1, 3.95).map(src));
    expect(a.size).toBe(1);
    expect(b.size).toBe(1);
    expect([...a][0]).not.toBe([...b][0]);
    expect(within(r.heard.gswitch, 0.1, 3.95).length).toBe(19); // one out per 200 ms beat (0.2 .. 3.8)
  });
  it('Max: gswitch starts on its left data inlet (0) and the bang at t=0 flips it, so the first 2 s are the random notes', async () => {
    const r = await render('gswitch', 0, { seconds: 1, listen: [{ box: '+ 60' }, { box: 'gswitch' }] });
    for (const x of within(r.heard.gswitch, 0.1, 0.95)) expect(x.msg[0]).toBe(r.heard['+ 60'].find((c) => c.t === x.t)!.msg[0]);
  });
});

describe('int/0: Remember a number', () => {
  it('"Each beat it sends its number, and + 1 and % 8 store the next one back: a counter, climbing a whole-tone scale"', async () => {
    const r = await render('int', 0, { seconds: 2.3, listen: [{ box: 'int' }, { box: '+ 60' }] });
    expect(firsts(r.heard.int).slice(0, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);
    expect(firsts(r.heard['+ 60']).slice(0, 9)).toEqual([60, 62, 64, 66, 68, 70, 72, 74, 60]);
    expect(r.heard.int.length).toBe(10); // no loop: one output per beat
  });
});

describe('loadbang/0: Set things up when the patch opens', () => {
  it('"it sends 392 to cycle~, so the tone starts at G instead of 0 Hz"', async () => {
    const r = await render('loadbang', 0, { seconds: 0.5 });
    expect(pitch(r.left, 0.01, 0.12)).toBeCloseTo(392, -1);
    expect(rms(r.left, 0.01, 0.12)).toBeCloseTo(0.2 / Math.SQRT2, 2);
  });
});

describe('loadmess/0: Start-up values', () => {
  it('"One sends 220 to cycle~ for the pitch; the other sends "1 3000" to line~, so the tone fades in over 3 seconds"', async () => {
    const r = await render('loadmess', 0, { seconds: 3.5 });
    const full = 0.2 / Math.SQRT2;
    expect(pitch(r.left, 1.0, 1.2)).toBeCloseTo(220, -1);
    expect(rms(r.left, 0, 0.05)).toBeLessThan(0.02 * full);
    expect(rms(r.left, 1.45, 1.55) / full).toBeCloseTo(0.5, 1);
    expect(rms(r.left, 3.1, 3.4) / full).toBeCloseTo(1, 1);
  });
});

describe('onebang/0: One bang, then wait', () => {
  it('"a new random note sounds about once a second, on the fast grid"', async () => {
    const r = await render('onebang', 0, { seconds: 4.05, listen: [{ box: 'onebang' }] });
    const t = times(r.heard.onebang);
    expect(t[0]).toBe(0);                      // onebang 1: the first bang gets through
    // Measured: 0, 0.1, 1.1, 2.1, 3.1. Both metros fire at t=0: the fast one passes, the
    // 1 s one re-arms it, so 0.1 passes too; after that the fast bang at each whole second
    // comes before the re-arm, so the note lands 100 ms later. (Max's order for two clocks
    // due at the same instant is not specified, so Max may differ by the same 100 ms.)
    expect(t.length).toBeGreaterThanOrEqual(4);
    expect(t.length).toBeLessThanOrEqual(5);
    const d = diffs(t);
    if (d[0] === 0.1) d.shift();
    for (const x of d) expect([1, 1.1]).toContain(x);
    for (const x of t) expect(Math.abs(x * 10 - Math.round(x * 10))).toBeLessThan(0.02);
  });
});

describe('peak/0: Only ever higher', () => {
  it('"peak outputs a number only when it is the highest so far, so the random notes can only climb ... Every 3 seconds ... resets the peak"', async () => {
    const r = await render('peak', 0, { seconds: 6.1, listen: [{ box: 'peak' }, { box: 'random' }] });
    for (const [t0, t1] of [[0.01, 2.99], [3.01, 5.99]]) {
      const outs = firsts(within(r.heard.peak, t0, t1)) as number[];
      for (let i = 1; i < outs.length; i++) expect(outs[i]).toBeGreaterThan(outs[i - 1]);
    }
    // after the reset the climb starts again: something lower than before the reset passes
    const before = within(r.heard.peak, 0, 2.99).at(-1)!.msg[0] as number;
    const after = within(r.heard.peak, 3.01, 6).map((x) => x.msg[0] as number);
    expect(Math.min(...after)).toBeLessThan(before);
  });
  it.fails('BUG: Max\'s peak sends a number into the right inlet out too ("is stored ... and is sent out"); the engine stays silent', async () => {
    const r = await render('peak', 0, { seconds: 3.1, listen: [{ box: 'peak' }] });
    expect(r.heard.peak.some((x) => Math.abs(x.t - 3) < 0.006 && x.msg[0] === 0)).toBe(true);
  });
});

describe('trough/0: Only ever lower', () => {
  it('"trough outputs a number only when it is the lowest so far, so the random notes can only fall ... resets the trough"', async () => {
    const r = await render('trough', 0, { seconds: 6.1, listen: [{ box: 'trough' }] });
    for (const [t0, t1] of [[0.01, 2.99], [3.01, 5.99]]) {
      const outs = firsts(within(r.heard.trough, t0, t1)) as number[];
      expect(outs.length).toBeGreaterThan(0);
      for (let i = 1; i < outs.length; i++) expect(outs[i]).toBeLessThan(outs[i - 1]);
    }
    const before = within(r.heard.trough, 0, 2.99).at(-1)!.msg[0] as number;
    const after = within(r.heard.trough, 3.01, 6).map((x) => x.msg[0] as number);
    expect(Math.max(...after)).toBeGreaterThan(before);
  });
  it.fails('BUG: Max\'s trough sends a number into the right inlet out too ("is stored ... and is sent out"); the engine stays silent', async () => {
    const r = await render('trough', 0, { seconds: 3.1, listen: [{ box: 'trough' }] });
    expect(r.heard.trough.some((x) => Math.abs(x.t - 3) < 0.006 && x.msg[0] === 24)).toBe(true);
  });
});

describe('route/0: Sort messages by their first word', () => {
  it('"strips it, and sends the rest out the matching outlet. Notes tagged "bass" play low (+ 36) and ... "lead" high (+ 72), each on its own oscillator"', async () => {
    const r = await render('route', 0, { seconds: 1.6, listen: [{ box: 'route', outlet: 0, label: 'bass' }, { box: 'route', outlet: 1, label: 'lead' }, { box: '+ 36' }, { box: '+ 72' }, { box: 'random', nth: 0, label: 'ra' }, { box: 'random', nth: 1, label: 'rb' }] });
    expect(r.heard.bass.map((x) => x.msg)).toEqual(r.heard.ra.map((x) => x.msg)); // "bass" stripped
    expect(r.heard.lead.map((x) => x.msg)).toEqual(r.heard.rb.map((x) => x.msg));
    expect(diffs(times(r.heard.bass))).toEqual([0.5, 0.5, 0.5]);
    expect(diffs(times(r.heard.lead)).slice(0, 5)).toEqual([0.25, 0.25, 0.25, 0.25, 0.25]);
    // both oscillators sound at once, each at its own note
    const lo = mtof(r.heard['+ 36'][1].msg[0] as number), hi = mtof(r.heard['+ 72'][2].msg[0] as number);
    expect(amp(r.left, 0.52, 0.74, lo)).toBeCloseTo(0.15, 1);
    expect(amp(r.left, 0.52, 0.74, hi)).toBeCloseTo(0.15, 1);
  });
});

describe('routepass/0: Let only some notes through', () => {
  it('"60, 64 or 67 comes out whole ... only the notes of a C major chord reach the oscillator"', async () => {
    const r = await render('routepass', 0, { seconds: 1.75, listen: [0, 1, 2, 3].map((o) => ({ box: 'routepass', outlet: o, label: `o${o}` })).concat([{ box: 'mtof', outlet: 0, label: 'mtof' }]) });
    expect(r.heard.o0.map((x) => x.msg)).toEqual([[60]]);
    expect(r.heard.o1.map((x) => x.msg)).toEqual([[64]]);
    expect(r.heard.o2.map((x) => x.msg)).toEqual([[67]]);
    expect(firsts(r.heard.o3)).toEqual([61, 62, 63, 65, 66, 68, 69, 70, 71]);
    expect(r.heard.mtof.map((x) => Math.round(x.msg[0] as number))).toEqual([262, 330, 392]);
  });
});

describe('router/0: Switching between two inputs', () => {
  it('"Every 1.6 seconds "patch 0 0" or "patch 1 0" connects one of them to outlet 0 and cuts the other, so the scale jumps between octaves"', async () => {
    const r = await render('router', 0, { seconds: 4.9, listen: [{ box: 'router' }, { box: 'counter', nth: 0, label: 'scale' }] });
    const span = (t0: number, t1: number) => within(r.heard.router, t0, t1);
    const a = span(0.1, 1.55), b = span(1.7, 3.15), c = span(3.3, 4.75);
    for (const x of a) expect(x.msg[0]).toBe(r.heard.scale.find((s) => s.t === x.t)!.msg[0]);
    for (const x of b) expect(x.msg[0]).toBe((r.heard.scale.find((s) => s.t === x.t)!.msg[0] as number) + 12);
    for (const x of c) expect(x.msg[0]).toBe(r.heard.scale.find((s) => s.t === x.t)!.msg[0]);
    expect(a.length).toBe(7); expect(b.length).toBe(7); // exactly one message per beat: the other is cut
  });
});

describe('select/0: Do something on one value', () => {
  it('"bang out of its left outlet when its input matches (0) ... The first beat of every four is an octave higher"', async () => {
    const r = await render('select', 0, { seconds: 2.1, listen: [{ box: 'select', outlet: 0, label: 'hit' }, { box: 'select', outlet: 1, label: 'rest' }, { box: 'mtof' }] });
    expect(r.heard.hit.map((x) => x.msg)).toEqual([['bang'], ['bang'], ['bang']]);
    expect(firsts(r.heard.rest).slice(0, 3)).toEqual([1, 2, 3]);
    expect(r.heard.mtof.map((x) => Math.round(x.msg[0] as number))).toEqual([523, 262, 262, 262, 523, 262, 262, 262, 523]);
    expect(pitch(r.left, 0.02, 0.2)).toBeCloseTo(523.25, -1);
    expect(pitch(r.left, 0.27, 0.45)).toBeCloseTo(261.6, -1);
  });
});

describe('select/1: sel: a rhythm from three numbers', () => {
  it('"sel 0 3 6 bangs on steps 0, 3 and 6 of an 8-step count, and each bang starts a short noise burst: the 3 + 3 + 2 rhythm"', async () => {
    const r = await render('select', 1, { seconds: 2.5, listen: [{ box: ' 1 2 0 120', label: 'burst' }] });
    expect(times(r.heard.burst)).toEqual([0, 0.45, 0.9, 1.2, 1.65, 2.1, 2.4]);   // 3, 3, 2 steps of 150 ms
    expect(rms(r.left, 0.005, 0.04)).toBeGreaterThan(0.05);
    expect(rms(r.left, 0.2, 0.44)).toBeLessThan(1e-4);                      // silent between bursts
  });
});

describe('split/0: Two sounds by range', () => {
  it('"split 60 71 sends numbers from 60 to 71 out its left outlet and all others out its right ... the smooth cycle~, the rest on the buzzy saw~"', async () => {
    const r = await render('split', 0, { seconds: 4, listen: [{ box: 'split', outlet: 0, label: 'in' }, { box: 'split', outlet: 1, label: 'out' }, { box: '+ 48' }] });
    const ins = firsts(r.heard.in) as number[], outs = firsts(r.heard.out) as number[];
    expect(ins.length + outs.length).toBe(r.heard['+ 48'].length);
    expect(ins.every((n) => n >= 60 && n <= 71)).toBe(true);
    expect(outs.every((n) => n < 60 || n > 71)).toBe(true);
    expect(ins.length).toBeGreaterThan(0); expect(outs.length).toBeGreaterThan(0);
    // the saw~ voice is buzzy: harmonic 3 is there, about 1/3 of the fundamental
    const o = r.heard.out.find((x) => x.t > 0.5)!;
    const f = mtof(o.msg[0] as number);
    const a1 = amp(r.left, o.t + 0.01, o.t + 0.19, f), a3 = amp(r.left, o.t + 0.01, o.t + 0.19, 3 * f);
    expect(a1).toBeGreaterThan(0.01);
    expect(a3 / a1).toBeCloseTo(1 / 3, 1);
    // and the cycle~ voice is smooth: only its fundamental
    const n = r.heard.in.find((x) => x.t > 0.5)!, fi = mtof(n.msg[0] as number);
    const b1 = amp(r.left, n.t + 0.01, n.t + 0.19, fi), b3 = amp(r.left, n.t + 0.01, n.t + 0.19, 3 * fi);
    expect(b1).toBeCloseTo(0.2, 1);
    expect(b3 / b1).toBeLessThan(0.15); // (what is left at 3f is the saw~ voice, still droning on its last note)
  });
});

describe('swap/0: Swap the order', () => {
  it('"Crossed into -, that makes 72 minus the count: a scale falling from 72 ... type a new top note into the number box"', async () => {
    const r = await render('swap', 0, { seconds: 2.9, listen: [{ box: 'swap', outlet: 0, label: 'L' }, { box: 'swap', outlet: 1, label: 'R' }, { box: '- 0' }], acts: [{ at: 2.1, box: 'number', msg: [84] }] });
    expect(r.heard.R[0].seq).toBeLessThan(r.heard.L[0].seq);               // right outlet first
    expect(firsts(r.heard['- 0']).slice(0, 9)).toEqual([72, 71, 70, 69, 68, 67, 66, 65, 72]);
    expect(firsts(within(r.heard['- 0'], 2.2, 3))).toEqual([84 - 1, 84 - 2, 84 - 3]);
  });
});

describe('switch/0: Listen to one of two melodies', () => {
  it('"loadmess picks the climbing scale; the toggle, plus 1, picks it or the random notes"', async () => {
    const r = await render('switch', 0, { seconds: 2.1, listen: [{ box: 'switch' }, { box: 'counter' }, { box: '+ 60' }], acts: [{ at: 1.1, box: 'toggle', msg: [1] }] });
    const before = within(r.heard.switch, 0, 1.1), after = within(r.heard.switch, 1.1, 3);
    expect(before.map((x) => x.msg[0])).toEqual(within(r.heard.counter, 0, 1.1).map((x) => x.msg[0]));
    expect(before.map((x) => x.msg[0])).toEqual([60, 61, 62, 63, 64, 65]);
    expect(after.map((x) => x.msg[0])).toEqual(within(r.heard['+ 60'], 1.1, 3).map((x) => x.msg[0]));
    expect(after.length).toBe(5);
  });
});

describe('trigger/0: Right to left, in order', () => {
  it('"trigger sends its input out of each outlet, right first ... each note is followed by its octave"', async () => {
    const r = await render('trigger', 0, { seconds: 1.3, listen: [{ box: 'trigger', outlet: 0, label: 'L' }, { box: 'trigger', outlet: 1, label: 'R' }, { box: 'mtof' }] });
    expect(r.heard.R[0].seq).toBeLessThan(r.heard.L[0].seq);
    expect(r.heard.mtof.map((x) => [Math.round(x.t * 100) / 100, Math.round(x.msg[0] as number)])).toEqual([[0, 262], [0.15, 523], [0.4, 277], [0.55, 554], [0.8, 294], [0.95, 587], [1.2, 311]]);
    expect(pitch(r.left, 0.02, 0.14)).toBeCloseTo(261.6, -1);
    expect(pitch(r.left, 0.17, 0.38)).toBeCloseTo(523.3, -1);
  });
});

describe('trigger/1: t: pick the octave first', () => {
  it('"t i b bangs its right outlet first: random picks 0 or 12 into the cold right inlet of +, and only then the note arrives ... never a beat late"', async () => {
    const r = await render('trigger', 1, { seconds: 3.1, listen: [{ box: 'counter' }, { box: 'random' }, { box: '+ 0' }] });
    const n = r.heard['+ 0'];
    expect(n.length).toBe(r.heard.counter.length);
    for (let i = 0; i < n.length; i++) {
      expect(r.heard.random[i].seq).toBeLessThan(n[i].seq);
      expect(n[i].msg[0]).toBe((r.heard.counter[i].msg[0] as number) + 12 * (r.heard.random[i].msg[0] as number));
    }
    expect(new Set(firsts(r.heard.random))).toEqual(new Set([0, 1]));
  });
});

// ─────────────────────────────────────────── Filters ─────────

describe('allpass~/0: A blip that flutters', () => {
  it('"passes every frequency at the same level but feeds its 30 ms delay back on itself, so each short blip trails a quick, fading flutter of echoes"', async () => {
    const r = await render('allpass~', 0, { seconds: 1.0 });
    // The blip is 42 ms; echoes every 30 ms, each 0.7 times the last, keep sounding after it ends.
    const e = (t: number) => rms(r.left, t, t + 0.01);
    expect(e(0.1)).toBeGreaterThan(1e-3);
    expect(e(0.2)).toBeGreaterThan(1e-4);
    expect(e(0.1)).toBeGreaterThan(e(0.2));
    expect(e(0.9)).toBeLessThan(e(0.2) / 10);
    // still 880 Hz
    expect(pitch(r.left, 0.005, 0.04)).toBeCloseTo(880, -1);
    // allpass: total energy is kept (sum of squares of output = input energy over the decay)
    const inE = (() => { let s = 0; for (let i = 0; i < 0.042 * SR; i++) { const t = i / SR; const g = t < 0.002 ? t / 0.002 : Math.max(0, 1 - (t - 0.002) / 0.04); s += (0.2 * g * Math.cos(2 * Math.PI * 880 * t)) ** 2; } return s; })();
    let outE = 0; for (let i = 0; i < 0.9 * SR; i++) outE += r.left[i] ** 2;
    expect(outE / inE).toBeCloseTo(1, 0);
  });
});

/** Gain (dB) the box adds at f, against the same patch with the box bypassed (so the source's own spectrum cancels). */
async function gains(object: string, index: number, box: string, freqs: number[], opts: { outlet?: number; seconds?: number; t0?: number; t1?: number; ch?: 'left' | 'right'; acts?: Act[] } = {}) {
  const seconds = opts.seconds ?? 1.2, t0 = opts.t0 ?? 0.3, t1 = opts.t1 ?? 1.1, ch = opts.ch ?? 'left';
  const r = await render(object, index, { seconds, acts: opts.acts });
  const ref = await render(object, index, { seconds, acts: opts.acts, edit: bypass(box, opts.outlet ?? 0) });
  return freqs.map((f) => db(amp(r[ch], t0, t1, f) / amp(ref.left, t0, t1, f)));
}

describe('biquad~/0: A filter from coefficients', () => {
  it('"These make an 800 Hz low-pass": each harmonic of the saw is scaled by the biquad\'s response', async () => {
    const [a0, a1, a2, b1, b2] = [0.003003, 0.006006, 0.003003, -1.839096, 0.851108];
    const H = (f: number) => {
      const w = (2 * Math.PI * f) / SR;
      const nr = a0 + a1 * Math.cos(w) + a2 * Math.cos(2 * w), ni = -a1 * Math.sin(w) - a2 * Math.sin(2 * w);
      const dr = 1 + b1 * Math.cos(w) + b2 * Math.cos(2 * w), di = -b1 * Math.sin(w) - b2 * Math.sin(2 * w);
      return Math.hypot(nr, ni) / Math.hypot(dr, di);
    };
    expect(db(H(800))).toBeCloseTo(-3, 0); // Max's biquad~: y = a0x + a1x1 + a2x2 - b1y1 - b2y2; these are an 800 Hz Butterworth low-pass
    const ks = [1, 2, 4, 7, 10, 16, 25];
    const g = await gains('biquad~', 0, 'biquad~ 0.003003 0.006006 0.003003 -1.839096 0.851108', ks.map((k) => 110 * k));
    ks.forEach((k, i) => expect(g[i]).toBeCloseTo(db(H(110 * k)), 0));
  });
});

describe('comb~/0: A metallic comb filter', () => {
  it('"A 5 ms delay with feedback (0.9) gives noise a pitch near 200 Hz"', async () => {
    const r = await render('comb~', 0, { seconds: 1.2 });
    expect(pitch(r.left, 0.2, 1.1)).toBeCloseTo(200, -1);
    // peaks at multiples of 200 Hz, dips halfway between
    let pk = 0, dip = 0;
    for (const f of [400, 600, 800, 1000]) { pk += amp(r.left, 0.2, 1.1, f); dip += amp(r.left, 0.2, 1.1, f + 100); }
    expect(pk / dip).toBeGreaterThan(3);
  });
});

describe('cross~/0: Lows left, highs right', () => {
  const F = [110, 220, 440, 770, 880, 1650, 3300];
  it('"splits a sawtooth at 800 Hz: the left outlet carries what is below, to the left speaker, and the right outlet what is above, to the right"', async () => {
    const L = await gains('cross~', 0, 'cross~ 800', F, { ch: 'left' });
    const R = await gains('cross~', 0, 'cross~ 800', F, { ch: 'right' });
    expect(L[1]).toBeGreaterThan(-1); expect(L[6]).toBeLessThan(-20);   // 220 passes left, 3300 cut
    expect(R[1]).toBeLessThan(-20); expect(R[6]).toBeGreaterThan(-1);   // and the other way round
    expect(L[3]).toBeGreaterThan(-6); expect(R[4]).toBeGreaterThan(-6); // the split is near 800
  });
  it('"drag the dial to move the split from 200 to 4000 Hz" (dial to 127: 4000 Hz)', async () => {
    const L = await gains('cross~', 0, 'cross~ 800', [2200, 3300], { seconds: 2.2, t0: 1.3, t1: 2.1, acts: [{ at: 1.1, box: 'dial', msg: [127] }] });
    expect(L[0]).toBeGreaterThan(-3); // 2200 Hz now on the left
  });
  it.fails('BUG: Max\'s cross~ is a pair of 3rd-order (18 dB/oct) filters; the engine uses one 2nd-order Web Audio biquad per side (Q 1 dB, peaking above 0 dB at the split)', async () => {
    const L = await gains('cross~', 0, 'cross~ 800', F, { ch: 'left' });
    const R = await gains('cross~', 0, 'cross~ 800', F, { ch: 'right' });
    expect(L[6]).toBeLessThan(-33);  // 3rd-order Butterworth: about -36 dB two octaves up (engine: about -25)
    expect(R[0]).toBeLessThan(-45);  // about -52 dB at 110 Hz (engine: about -34)
    expect(L[3]).toBeLessThan(0);    // no bump at the split (engine: +1.3 dB at 770 Hz)
  });
});

describe('deltaclip~/0: Soften a square wave', () => {
  it('"lets a signal move at most 0.02 per sample, so rect~\'s instant jumps from -1 to 1 become 100-sample slopes"', async () => {
    const r = await render('deltaclip~', 0, { seconds: 0.5 });
    const x = r.left.subarray(Math.round(0.1 * SR), Math.round(0.4 * SR));
    let maxStep = 0;
    for (let i = 1; i < x.length; i++) maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1]));
    expect(maxStep).toBeLessThanOrEqual(0.2 * 0.02 * 1.001);  // 0.02 per sample, after *~ 0.2
    expect(maxStep).toBeGreaterThan(0.2 * 0.02 * 0.95);       // and it is the limit that shapes it
    // a whole rise takes (top - bottom) / 0.004 samples: 100 for a -1..1 square
    const top = peak(r.left, 0.1, 0.4);
    let i = 0;
    while (x[i] > -0.9 * top) i++;
    while (x[i] < -0.9 * top) i++;
    const start = i;
    while (x[i] < 0.9 * top) i++;
    const expectSamples = (1.8 * top) / (0.2 * 0.02);
    expect(i - start).toBeGreaterThan(expectSamples - 4);
    expect(i - start).toBeLessThan(expectSamples + 6);
  });
  it.fails('BUG: rect~ is a Web Audio "square" OscillatorNode (web/src/objects/audio/osc.ts:37), normalised so its Gibbs overshoot peaks at 1: the flat top is about 0.88, so the jump is 1.76, an 88-sample slope instead of Max\'s 100', async () => {
    const r = await render('deltaclip~', 0, { seconds: 0.5 });
    expect(peak(r.left, 0.1, 0.4)).toBeGreaterThan(0.19);
  });
});

describe('lores~/0: Filter a buzzy sawtooth', () => {
  const ks = [1, 2, 3, 4, 5, 6, 8, 10, 20];
  it('"it keeps frequencies below the cutoff (600 Hz here)"', async () => {
    const g = await gains('lores~', 0, 'lores~ 600 0.7', ks.map((k) => 110 * k));
    expect(Math.abs(g[0])).toBeLessThan(1);  // 110 Hz passes
    expect(g[6]).toBeLessThan(-3);           // 880 Hz falls
    expect(g[8]).toBeLessThan(-18);          // 2200 Hz cut
  });
  it.fails('BUG: "the resonance (0.7) makes a peak there" — engine maps resonance 0..1 straight onto Web Audio Q in dB (0.7 dB), so there is only a +1.7 dB bump near 440 Hz, none at 600', async () => {
    const g = await gains('lores~', 0, 'lores~ 600 0.7', [110, 550, 660]);
    expect(Math.max(g[1], g[2]) - g[0]).toBeGreaterThan(3);
  });
});

describe('lores~/1: A filter sweep', () => {
  // the -3 dB point of the filter at time t, from the saw's harmonics against the bypassed patch
  const edge = async (ts: number[]) => {
    const r = await render('lores~', 1, { seconds: 4.1 }), ref = await render('lores~', 1, { seconds: 4.1, edit: bypass('lores~ 0 0.8') });
    return ts.map((t) => {
      let k = 2;
      while (k < 40 && db(amp(r.left, t - 0.08, t + 0.08, 98 * k) / amp(ref.left, t - 0.08, t + 0.08, 98 * k)) > -3) k++;
      return 98 * k;
    });
  };
  it('"Audio into lores~\'s middle inlet moves the cutoff: a slow cycle~ sweeps it between 300 and 1700 Hz"', async () => {
    const e = await edge([0.2, 0.6, 1.0, 1.4, 1.8, 2.2, 2.6, 3.0, 3.4, 3.8]);
    // with Q 0.8 the -3 dB point sits a little above the cutoff
    expect(Math.max(...e)).toBeGreaterThan(1700);
    expect(Math.max(...e)).toBeLessThan(1700 * 1.5);
    expect(Math.min(...e)).toBeGreaterThan(300);
    expect(Math.min(...e)).toBeLessThan(300 * 1.75); // harmonics of 98 Hz: the edge is found on a 98 Hz grid
  });
  it.fails('BUG: cycle~ is a cosine in Max (starts at 1), the engine\'s is a sine (starts at 0): the sweep should start at 1700 Hz and reach 300 Hz at 2 s', async () => {
    const [a, b] = await edge([0.1, 2.0]);
    expect(a).toBeGreaterThan(1600);
    expect(b).toBeLessThan(600);
  });
});

describe('onepole~/0: A gentle low-pass', () => {
  it('"it softens everything above its frequency (500 Hz), without resonance"', async () => {
    const ks = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20];
    const g = await gains('onepole~', 0, 'onepole~ 500', ks.map((k) => 110 * k));
    for (let i = 1; i < ks.length; i++) expect(g[i]).toBeLessThan(g[i - 1] + 0.1); // no peak anywhere
    expect(g[0]).toBeGreaterThan(-0.5);
    expect(g[4]).toBeCloseTo(-3, 0);    // 550 Hz: about the -3 dB point
    expect(g[9]).toBeLessThan(-11);     // 2200 Hz: one pole, about -13 dB
    expect(g[9]).toBeGreaterThan(-16);
  });
});

describe('rampsmooth~/0: Glide between notes', () => {
  it('"counter steps through 220, 330, 440 and 550 Hz ... spreads every jump over 4410 samples (0.1 s), so cycle~ slides"', async () => {
    const r = await render('rampsmooth~', 0, { seconds: 2.0, listen: [{ box: '* 110' }] });
    expect(firsts(r.heard['* 110']).slice(0, 5)).toEqual([220, 330, 440, 550, 220]);
    expect(pitch(r.left, 0.2, 0.38)).toBeCloseTo(220, -1);   // the first glide is from 220 (sig~ 220)
    expect(pitch(r.left, 0.55, 0.78)).toBeCloseTo(330, -1);
    expect(pitch(r.left, 0.95, 1.18)).toBeCloseTo(440, -1);
    // halfway through the slide from 330 to 440 (0.8 + 0.05 s): about 385 Hz
    expect(pitch(r.left, 0.835, 0.865)).toBeGreaterThan(355);
    expect(pitch(r.left, 0.835, 0.865)).toBeLessThan(415);
  });
});

describe('reson~/0: Ringing noise', () => {
  it('"With a high Q (25) it turns white noise into a whistling tone at 880 Hz"', async () => {
    const r = await render('reson~', 0, { seconds: 1.2 });
    expect(pitch(r.left, 0.2, 1.1)).toBeCloseTo(880, -1.5);
    const at = (f: number) => amp(r.left, 0.2, 1.1, f);
    expect(at(880)).toBeGreaterThan(5 * at(600));
    expect(at(880)).toBeGreaterThan(5 * at(1200));
  });
});

describe('svf~/0: One filter, four outputs', () => {
  it('"This plays the band-pass (outlet 2) of a sawtooth" (centre 1200 Hz)', async () => {
    const ks = Array.from({ length: 30 }, (_, i) => i + 1);
    const g = await gains('svf~', 0, 'svf~ 1200 0.8', ks.map((k) => 110 * k), { outlet: 2 });
    const best = Math.max(...g), bk = ks[g.indexOf(best)];
    expect(Math.abs(110 * bk - 1200)).toBeLessThan(120);   // a peak at the centre
    expect(g[0] - best).toBeLessThan(-20);                 // lows cut
    expect(g[29] - best).toBeLessThan(-15);                // highs cut
  });
});

describe('teeth~/0: A comb filter that steps down in pitch', () => {
  it('"Every half second the counter sets the feedback delay to 2, 3 ... 10 ms, so the noise rings at ... 333 Hz, down to 100 Hz"', async () => {
    const r = await render('teeth~', 0, { seconds: 4.6, listen: [{ box: 'counter' }] });
    expect(firsts(r.heard.counter).slice(0, 9)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let i = 1; i < 9; i++) {
      const ms = 2 + i, t = i * 0.5;
      expect(pitch(r.left, t + 0.08, t + 0.48)).toBeCloseTo(1000 / ms, -1);
    }
  });
  it.fails('BUG (example): at a 2 ms feedback delay it does not ring at 500 Hz but 1000 Hz: the 1 ms feedforward copy (1 + z^-1ms) has its zeros at 500, 1500 Hz..., cancelling the odd peaks', async () => {
    const r = await render('teeth~', 0, { seconds: 0.5 });
    expect(pitch(r.left, 0.08, 0.48)).toBeCloseTo(500, -1);
  });
});

// ─────────────────────────────────────────── Timing ─────────

describe('clocker/0: How long since it started', () => {
  it('"reports the milliseconds since it was started, every 50 ms ... a pitch that climbs from 200 to 800 Hz and starts over every 2 seconds"', async () => {
    const r = await render('clocker', 0, { seconds: 4.1, listen: [{ box: 'clocker' }, { box: 'scale' }] });
    const c = r.heard.clocker;
    expect(diffs(times(c)).every((d) => Math.abs(d - 0.05) < 0.011)).toBe(true);
    for (const x of c) expect(x.msg[0] as number).toBeCloseTo(x.t * 1000, -1.5);   // elapsed ms
    r.heard.scale.forEach((x, i) => expect(x.msg[0] as number).toBeCloseTo(200 + 0.3 * ((c[i].msg[0] as number) % 2000), 3)); // scale 0 2000 200 800 of % 2000
    expect(pitch(r.left, 1.5, 1.55)).toBeGreaterThan(600);
    expect(pitch(r.left, 2.05, 2.1)).toBeLessThan(260);    // started over
  });
});

describe('delay/0: A bang, later', () => {
  it('"Each beat plays note 60, and 150 ms later note 67"', async () => {
    const r = await render('delay', 0, { seconds: 1.3, listen: [{ box: 'mtof' }] });
    expect(r.heard.mtof.map((x) => [Math.round(x.t * 100) / 100, Math.round(x.msg[0] as number)])).toEqual([[0, 262], [0.15, 392], [0.6, 262], [0.75, 392], [1.2, 262]]);
    expect(pitch(r.left, 0.02, 0.14)).toBeCloseTo(261.6, -1);
    expect(pitch(r.left, 0.17, 0.58)).toBeCloseTo(392, -1);
  });
});

describe('line/0: A glide between numbers', () => {
  it('"220, 880 1500 jumps to 220, then glides to 880 over 1.5 seconds, every 2 seconds"', async () => {
    const r = await render('line', 0, { seconds: 4.1, listen: [{ box: 'line' }] });
    for (const x of within(r.heard.line, 0, 1.99)) {
      const want = x.t >= 1.5 ? 880 : 220 + (660 * x.t) / 1.5;
      expect(Math.abs((x.msg[0] as number) - want)).toBeLessThan(660 * 0.025 + 1); // within a 20 ms grain
    }
    expect(within(r.heard.line, 1.99, 2.01)[0].msg[0]).toBe(220);
    expect(pitch(r.left, 0.74, 0.8)).toBeCloseTo(550, -1.3);
    expect(pitch(r.left, 1.6, 1.95)).toBeCloseTo(880, -1);
  });
});

describe('metro/0: A clock that plays notes', () => {
  it('"metro sends a bang every 250 ms. counter counts 0 to 7, + 60 ... mtof into hertz"', async () => {
    const r = await render('metro', 0, { seconds: 2.3, listen: [{ box: 'metro' }, { box: '+ 60' }] });
    expect(diffs(times(r.heard.metro)).slice(0, 8)).toEqual(Array(8).fill(0.25));
    expect(firsts(r.heard['+ 60']).slice(0, 9)).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 60]);
    expect(pitch(r.left, 1.02, 1.23)).toBeCloseTo(mtof(64), -1);
  });
});

describe('metro/1: Two clocks against each other', () => {
  it('"Two metros at 300 ms and 400 ms drift in and out of step, a 3-against-4 rhythm. Each picks a note for its own oscillator"', async () => {
    const r = await render('metro', 1, { seconds: 2.5, listen: [{ box: 'metro', nth: 0, label: 'a' }, { box: 'metro', nth: 1, label: 'b' }, { box: '+ 64' }, { box: '+ 52' }] });
    expect(times(r.heard.a)).toEqual([0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4]);
    expect(times(r.heard.b)).toEqual([0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4]);   // together every 1.2 s
    const fa = mtof(within(r.heard['+ 64'], 0.85, 0.95)[0].msg[0] as number), fb = mtof(within(r.heard['+ 52'], 0.75, 0.85)[0].msg[0] as number);
    expect(amp(r.left, 0.92, 1.18, fa)).toBeCloseTo(0.15, 1);
    expect(amp(r.left, 0.92, 1.18, fb)).toBeCloseTo(0.15, 1);
  });
});

describe('pipe/0: Delaying numbers', () => {
  it('"Each step plays, then a fifth above it plays 200 ms later"', async () => {
    const r = await render('pipe', 0, { seconds: 1.3, listen: [{ box: 'counter' }, { box: 'pipe' }] });
    expect(firsts(r.heard.counter).slice(0, 3)).toEqual([57, 58, 59]);
    expect(r.heard.pipe.map((x) => [Math.round(x.t * 100) / 100, x.msg[0]])).toEqual([[0.2, 64], [0.6, 65], [1.0, 66]]);
    expect(pitch(r.left, 0.25, 0.38)).toBeCloseTo(329.6, -1);
  });
});

describe('qmetro/0: A metro for the screen', () => {
  it('"every 200 ms it steps a counter through a stack of fourths ... type a new interval into the number box"', async () => {
    const r = await render('qmetro', 0, { seconds: 2.5, listen: [{ box: 'qmetro' }, { box: '+ 55' }], acts: [{ at: 1.3, box: 'number', msg: [100] }] });
    expect(diffs(times(within(r.heard.qmetro, 0, 1.25)))).toEqual(Array(5).fill(0.2)); // 0.2 .. 1.2 (engine: first bang at 0.2, not 0)
    expect(firsts(r.heard['+ 55']).slice(0, 6)).toEqual([55, 60, 65, 70, 75, 55]);
    const late = diffs(times(within(r.heard.qmetro, 1.45, 2.5)));
    expect(late.every((d) => Math.abs(d - 0.1) < 0.011)).toBe(true);
  });
});

describe('speedlim/0: Slow a fast stream down', () => {
  it('"speedlim lets at most one number through every 250 ms ... type a new limit (ms) into the number box"', async () => {
    const r = await render('speedlim', 0, { seconds: 3.1, listen: [{ box: 'speedlim' }, { box: 'counter' }], acts: [{ at: 2.0, box: 'number', msg: [100] }] });
    const early = times(within(r.heard.speedlim, 0, 2.0));
    for (const d of diffs(early)) { expect(d).toBeGreaterThanOrEqual(0.249); expect(d).toBeLessThan(0.3); }
    expect(early.length).toBeGreaterThanOrEqual(7);
    const late = diffs(times(within(r.heard.speedlim, 2.2, 3.1)));
    for (const d of late) { expect(d).toBeGreaterThanOrEqual(0.099); expect(d).toBeLessThan(0.15); }
    // "a few steps of the climb": every value passed is one the counter just sent
    for (const x of r.heard.speedlim) expect(r.heard.counter.some((c) => c.t <= x.t && c.msg[0] === x.msg[0])).toBe(true);
  });
});

describe('tempo/0: A clock in beats per minute', () => {
  it('"Each count, times 5, walks the notes around a circle of fourths"', async () => {
    const r = await render('tempo', 0, { seconds: 1.1, listen: [{ box: '+ 60' }] });
    expect(firsts(r.heard['+ 60']).slice(0, 4)).toEqual([60, 65, 70, 63]); // 0, 5, 10, 15 % 12 = 3
  });
  it.fails('BUG: "tempo counts 0 to 7 in eighth notes at 60 BPM": Max\'s division is of a whole note (60 BPM, 1/8 = 500 ms); the engine uses 60000/bpm*mult/div = 125 ms, 4x too fast (web/src/objects/control/timing.ts:30)', async () => {
    const r = await render('tempo', 0, { seconds: 5.6, listen: [{ box: 'tempo' }], acts: [{ at: 4.1, box: 'number', msg: [120] }] });
    const early = within(r.heard.tempo, 0, 4.05);
    expect(firsts(early)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);       // Max: the count wraps at the division
    expect(diffs(times(early))).toEqual(Array(8).fill(0.5));
    const late = diffs(times(within(r.heard.tempo, 4.3, 5.6)));        // "type a new BPM": 120 -> 250 ms
    expect(late.every((d) => Math.abs(d - 0.25) < 0.011)).toBe(true);
  });
});

describe('uzi/0: Many bangs at once', () => {
  it('"Each beat it bangs the counter 3 times, so the note jumps 3 semitones ... type another burst size into the number box"', async () => {
    const r = await render('uzi', 0, { seconds: 2.1, listen: [{ box: 'counter' }, { box: '+ 60' }], acts: [{ at: 1.0, box: 'number', msg: [4] }] });
    const c = r.heard.counter;
    expect(firsts(within(c, 0, 0.99))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(times(within(c, 0, 0.99))).toEqual([0, 0, 0, 0.4, 0.4, 0.4, 0.8, 0.8, 0.8]);   // same instant
    // what you hear each beat is the last of the burst: 62, 65, 68
    expect(pitch(r.left, 0.42, 0.78)).toBeCloseTo(mtof(65), -1);
    expect(within(c, 1.15, 1.25).length).toBe(4);
  });
});

// ─────────────────────────────────────────── Envelopes ─────────

describe('adsr~/0: Attack, decay, sustain, release', () => {
  it('"A number above 0 starts the note ...; 0 releases it. counter alternates 1 and 0, so the note holds for 600 ms, then fades"', async () => {
    const r = await render('adsr~', 0, { seconds: 2.5, listen: [{ box: 'counter' }] });
    expect(firsts(r.heard.counter).slice(0, 4)).toEqual([0, 1, 0, 1]);
    const on = r.heard.counter[1].t, off = r.heard.counter[2].t;
    expect(off - on).toBeCloseTo(0.6, 2);
    // full level: the same patch with adsr~ replaced by a steady sig~ 1
    const ref = await render('adsr~', 0, { seconds: 0.5, edit: (p: any) => {
      const b = p.patcher.boxes.find((x: any) => x.box.text === 'adsr~ 10 150 0.5 300').box;
      b.text = 'sig~ 1';
      p.patcher.lines = p.patcher.lines.filter((l: any) => l.patchline.destination[0] !== b.id);
    } });
    const P = 1 / 110, full = rms(ref.left, 0.2, 0.2 + 10 * P); // one saw~ period per window
    const lv = (t: number) => rms(r.left, t, t + P) / full;
    expect(lv(0.1)).toBeLessThan(0.01);              // 0 at first: silent
    expect(lv(on + 0.007)).toBeGreaterThan(0.8);     // attack: about 1 around 10 ms
    expect(lv(on + 0.3)).toBeCloseTo(0.5, 1);        // decayed to the sustain, 0.5
    expect(lv(on + 0.55)).toBeCloseTo(0.5, 1);       // held until the 0
    expect(lv(off + 0.145)).toBeCloseTo(0.25, 1);    // release: 0.5 -> 0 over 300 ms
    expect(lv(off + 0.32)).toBeLessThan(0.02);
  });
});

describe('curve~/0: A curved fade', () => {
  it.fails('BUG: "A curve of 0.8 makes the 800 ms fade drop fast, then linger": the engine ignores the curve (its linearRampToValueAtTime overrides the setTargetAtTime, web/src/objects/audio/env.ts:97-98), so the fade is a straight line', async () => {
    const r = await render('curve~', 0, { seconds: 1.0 });
    const full = 0.2 / Math.sqrt(3); // tri~ rms
    const lv = (t: number) => rms(r.left, t - 0.01, t + 0.01) / full;
    expect(lv(0.03)).toBeGreaterThan(0.9);
    // linear would be 0.75 at a quarter of the fade and 0.25 at three quarters
    expect(lv(0.205)).toBeLessThan(0.6);
    expect(lv(0.605)).toBeLessThan(0.2);
    expect(lv(0.605)).toBeGreaterThan(0.005); // still lingering
  });
  it('measured: the fade is linear (0.75 at a quarter, 0.25 at three quarters)', async () => {
    const r = await render('curve~', 0, { seconds: 1.0 });
    const full = 0.2 / Math.sqrt(3), P = 1 / 330;
    const lv = (t: number) => rms(r.left, t, t + 3 * P) / full;
    expect(lv(0.2) ).toBeCloseTo(0.76, 1);
    expect(lv(0.6)).toBeCloseTo(0.26, 1);
  });
});

describe('line~/0: A plucked note', () => {
  it('"up to 1 in 10 ms, then down to 0 over 400 ms"', async () => {
    const r = await render('line~', 0, { seconds: 0.7 });
    const full = 0.2 / Math.SQRT2;
    const lv = (t: number) => rms(r.left, t - 0.0025, t + 0.0025) / full;
    expect(lv(0.0125)).toBeCloseTo(1, 1);
    expect(lv(0.11)).toBeCloseTo(0.75, 1);
    expect(lv(0.21)).toBeCloseTo(0.5, 1);
    expect(lv(0.31)).toBeCloseTo(0.25, 1);
    expect(rms(r.left, 0.42, 0.59)).toBeLessThan(1e-4);
    expect(pitch(r.left, 0.02, 0.2)).toBeCloseTo(440, -1);
  });
});

describe('trapezoid~/0: Repeating swells', () => {
  it('"up to 1 by phase 0.05, held until 0.5, then down to 0 at the end ... each third of a second starts fast and fades"', async () => {
    const r = await render('trapezoid~', 0, { seconds: 1.1 });
    const full = 0.2 / Math.SQRT2, P = 1 / 3;
    const lv = (ph: number) => rms(r.left, P + ph * P - 0.003, P + ph * P + 0.003) / full;
    expect(lv(0.025)).toBeCloseTo(0.5, 1);
    expect(lv(0.1)).toBeCloseTo(1, 1);
    expect(lv(0.45)).toBeCloseTo(1, 1);
    expect(lv(0.75)).toBeCloseTo(0.5, 1);
    expect(lv(0.97)).toBeLessThan(0.15);
    expect(pitch(r.left, P + 0.05, P + 0.15)).toBeCloseTo(523, -1);
  });
});

// ─────────────────────────────────────────── Max for Live ─────────

describe('live.dial/0: A Live dial on a filter', () => {
  it('"It sends 0..127 as you turn it, and scale maps that onto a 200..4000 Hz cutoff for lores~"', async () => {
    const r = await render('live.dial', 0, { seconds: 2.2, listen: [{ box: 'live.dial' }, { box: 'scale' }], acts: [{ at: 1.1, box: 'live.dial', msg: [127] }] });
    expect(firsts(within(r.heard['live.dial'], 1, 3))).toEqual([127]);
    expect(firsts(within(r.heard.scale, 1, 3))).toEqual([4000]);
    const g = await gains('live.dial', 0, 'lores~ 800 0.6', [110, 2200], { seconds: 2.2, t0: 1.3, t1: 2.1, acts: [{ at: 1.1, box: 'live.dial', msg: [127] }] });
    expect(g[0]).toBeGreaterThan(-1);
    expect(g[1]).toBeGreaterThan(-4);     // 2200 Hz passes at 4000
  });
  it.fails('BUG: "800 Hz until you turn the dial": the engine\'s live.dial sends its value (0) when the transport starts (start: output, web/src/objects/ui/live-dial.ts), so the cutoff drops to 200 Hz; Max sends nothing at load unless Initial Value is enabled', async () => {
    const r = await render('live.dial', 0, { seconds: 1.0, listen: [{ box: 'live.dial' }] });
    expect(r.heard['live.dial']).toEqual([]);
    const g = await gains('live.dial', 0, 'lores~ 800 0.6', [110, 440, 2200], { seconds: 1.0, t0: 0.2, t1: 0.95 });
    expect(g[1]).toBeGreaterThan(-3);    // 440 Hz passes at 800 (engine: -12.8 dB)
    expect(g[2]).toBeLessThan(-15);
  });
});

describe('live.gain~/0: A Live volume fader', () => {
  it('"scales a stereo signal by a level in dB ... loadbang sets it to 0 dB (full level) ... drag the fader down to fade the chord out"', async () => {
    const r = await render('live.gain~', 0, { seconds: 2.0, acts: [{ at: 1.0, box: 'live.gain~', msg: [-20] }] });
    const full = 0.2 / Math.SQRT2;
    expect(rms(r.left, 0.2, 0.9) / full).toBeCloseTo(1, 1);
    expect(rms(r.right, 0.2, 0.9) / full).toBeCloseTo(1, 1);
    expect(pitch(r.left, 0.2, 0.5)).toBeCloseTo(220, -1);
    expect(pitch(r.right, 0.2, 0.5)).toBeCloseTo(277, -1);
    expect(rms(r.left, 1.5, 1.95) / full).toBeCloseTo(0.1, 1);  // -20 dB
  });
});

describe('plugin~/0: An audio effect on a track', () => {
  it('"the track is a guitar loop, and overdrive~ distorts it ... drag the dial to drive it harder"', async () => {
    const r = await render('plugin~', 0, { seconds: 3.0, acts: [{ at: 1.5, box: 'dial', msg: [127] }] });
    expect(rms(r.left, 0.2, 1.4)).toBeGreaterThan(0.01);
    expect(rms(r.right, 0.2, 1.4)).toBeGreaterThan(0.01);
    expect(peak(r.left)).toBeLessThanOrEqual(0.5 + 1e-6);                 // overdrive~ never exceeds 1, *~ 0.5
    const crest = (t0: number, t1: number) => peak(r.left, t0, t1) / rms(r.left, t0, t1);
    expect(crest(1.6, 2.9)).toBeLessThan(crest(0.2, 1.4));                 // drive 12 squashes it more
    expect(rms(r.left, 1.6, 2.9)).toBeGreaterThan(rms(r.left, 0.2, 1.4));  // and louder
  });
});

describe('plugout~/0: An instrument\'s output', () => {
  it('"a metro plays a short arpeggio on a triangle wave" (57, 61, 65, 69 every 180 ms, left and right)', async () => {
    const r = await render('plugout~', 0, { seconds: 0.8, listen: [{ box: '+ 57' }] });
    expect(firsts(r.heard['+ 57'])).toEqual([57, 61, 65, 69, 57]);
    for (const [i, m] of [57, 61, 65, 69].entries()) {
      expect(pitch(r.left, i * 0.18 + 0.02, i * 0.18 + 0.17)).toBeCloseTo(mtof(m), -1);
      expect(pitch(r.right, i * 0.18 + 0.02, i * 0.18 + 0.17)).toBeCloseTo(mtof(m), -1);
    }
    // triangle: odd harmonics at 1/k², so the 3rd is 1/9 of the fundamental
    const f = mtof(61);
    expect(amp(r.left, 0.2, 0.35, 3 * f) / amp(r.left, 0.2, 0.35, f)).toBeCloseTo(1 / 9, 1);
  });
});

