// Group 2 claims: every example's title/note held to what it says, in the engine and per Max's reference.
import { describe, expect, it, vi } from 'vitest';
import '../../../web/src/objects';
import { Engine } from '../../../web/src/engine/engine';
import { parseMaxPat } from '../../../web/src/parser/maxpat';
import { preloadWorklets } from '../../../web/src/runtime/worklet';
import { example, boxIds, pitch, rms, peak, firsts, SR, type Heard, type Listen } from './helpers/measure';

type Atom = number | string;

// ── A local runner: the helper's run(), plus messages injected into boxes at given times (a
// user dragging a number box / dial), an edited copy of the patch, and a chosen clock time.
interface Act { t: number; box: string; nth?: number; inlet?: number; msg: Atom[] }
interface Opts { seconds?: number; listen?: Listen[]; actions?: Act[]; edit?: (p: any) => void; systemTime?: Date }
async function go(object: string, index: number, opts: Opts = {}) {
  const ex = example(object, index);
  const patch = JSON.parse(JSON.stringify(ex.patch));
  opts.edit?.(patch);
  const exx = { ...ex, patch };
  const seconds = opts.seconds ?? 2.5;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  if (opts.systemTime) vi.setSystemTime(opts.systemTime);
  let seed = 1;
  const rand = vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const engine = new Engine(ctx);
  try {
    await preloadWorklets(ctx);
    engine.build(parseMaxPat(patch));
    const nodes = (engine as unknown as { nodes: Map<string, any> }).nodes;
    let now = 0;
    const heard: Record<string, Heard[]> = {};
    for (const l of opts.listen ?? []) {
      const id = boxIds(exx as any, l.box)[l.nth ?? 0];
      if (!id) throw new Error(`${object}/${index} has no box "${l.box}"`);
      const label = l.label ?? l.box;
      heard[label] = [];
      nodes.get(id)?.onControlOut?.(l.outlet ?? 0, (m: Atom[]) => heard[label].push({ t: now, msg: [...m] }));
    }
    const acts = (opts.actions ?? []).map((a) => ({ ...a, done: false }));
    await engine.start();
    for (let i = 1; i * 0.01 < seconds; i++) {
      const at = Math.round((i * 0.01 * SR) / 128) * 128 / SR;
      if (at * SR >= ctx.length) break;
      void ctx.suspend(at).then(() => {
        now = at;
        for (const a of acts) {
          if (a.done || a.t > at + 1e-9) continue;
          a.done = true;
          const id = boxIds(exx as any, a.box)[a.nth ?? 0];
          nodes.get(id).controlIns[a.inlet ?? 0](a.msg);
        }
        vi.advanceTimersByTime(10);
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

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const nums = (h: Heard[]) => firsts(h).map(Number);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** Each value close to the expected one (6 decimals by default). */
function closeTo(got: number[], want: number[], digits = 4) {
  expect(got.length).toBeGreaterThanOrEqual(want.length);
  want.forEach((w, i) => expect(got[i], `item ${i}`).toBeCloseTo(w, digits));
}
const diffs = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);
const gaps = (h: Heard[]) => diffs(h.map((x) => x.t));
/** Pitch of the note that starts at t0 and lasts dur, skipping its edges. */
const noteHz = (x: Float32Array, t0: number, dur: number) => pitch(x, t0 + 0.02, t0 + dur - 0.02);
/** Time of the first sample at or after t0 louder than level. */
function onset(x: Float32Array, t0: number, level = 0.01) {
  for (let i = Math.round(t0 * SR); i < x.length; i++) if (Math.abs(x[i]) > level) return i / SR;
  return Infinity;
}
/** Brightness: RMS of the sample-to-sample difference over RMS (grows with high harmonics). */
function bright(x: Float32Array, t0: number, t1: number) {
  let d = 0, e = 0;
  for (let i = Math.round(t0 * SR) + 1; i < Math.round(t1 * SR); i++) { d += (x[i] - x[i - 1]) ** 2; e += x[i] * x[i]; }
  return Math.sqrt(d / Math.max(e, 1e-12));
}
const replaceText = (from: string, to: string) => (p: any) => {
  for (const b of p.patcher.boxes) if (b.box.text === from) b.box.text = to;
};

// ═══ Math on a counter: the sequence the melody plays, the clock, and the sound ═══

describe('abs/0: Down and back up', () => {
  it('"abs makes that 6, 5 ... 0 ... 5, 6, so the whole-tone melody falls to note 60 and climbs back"', async () => {
    const r = await go('abs', 0, { seconds: 2.5, listen: [{ box: 'abs' }, { box: '+ 60' }] });
    expect(nums(r.heard.abs).slice(0, 13)).toEqual([6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6]);
    expect(nums(r.heard['+ 60']).slice(0, 13)).toEqual([72, 70, 68, 66, 64, 62, 60, 62, 64, 66, 68, 70, 72]);
    gaps(r.heard.abs).forEach((g) => expect(g).toBeCloseTo(0.18, 1));
    expect(noteHz(r.left, 0, 0.18)).toBeCloseTo(mtof(72), -1);
    expect(noteHz(r.left, 6 * 0.18, 0.18)).toBeCloseTo(mtof(60), -1);
    expect(rms(r.left, 0.02, 0.16)).toBeCloseTo(0.2 / Math.SQRT2, 2);
  });
});

describe('acos/0: A fall that plunges', () => {
  it('"0 gives π/2 and 1 gives 0 ... the pitch falls from note 73.6 to 50, gently at first and steeply at the end"', async () => {
    const r = await go('acos', 0, { seconds: 2.3, listen: [{ box: 'acos' }, { box: '+ 50.0' }] });
    closeTo(nums(r.heard.acos), range(0, 10).map((k) => Math.acos(k / 10)));
    const notes = nums(r.heard['+ 50.0']).slice(0, 11);
    expect(notes[0]).toBeCloseTo(73.56, 1);
    expect(notes[10]).toBeCloseTo(50, 5);
    const d = diffs(notes);
    d.forEach((x) => expect(x).toBeLessThan(0));
    for (let i = 1; i < d.length; i++) expect(Math.abs(d[i])).toBeGreaterThan(Math.abs(d[i - 1]));
    expect(noteHz(r.left, 0, 0.2)).toBeCloseTo(mtof(73.56), -1);
  });
});

describe('acosh/0: Big steps, then small', () => {
  it('"For 1..16 the melody jumps up from note 55 and then climbs in ever smaller steps"', async () => {
    const r = await go('acosh', 0, { seconds: 3, listen: [{ box: '+ 55.0' }] });
    const notes = nums(r.heard['+ 55.0']).slice(0, 16);
    closeTo(notes, range(1, 16).map((k) => 55 + 7 * Math.acosh(k)));
    const d = diffs(notes);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThan(d[i - 1]);
    expect(noteHz(r.left, 0, 0.18)).toBeCloseTo(mtof(55), -1);
  });
});

describe('asin/0: Fast at the edges, slow in the middle', () => {
  it('"asin takes -1..1 and gives -π/2..π/2 ... leaps at the start and end and inches through the middle"', async () => {
    const r = await go('asin', 0, { seconds: 3.2, listen: [{ box: 'scale' }, { box: 'asin' }, { box: '+ 66.0' }] });
    closeTo(nums(r.heard.scale), range(0, 20).map((k) => -1 + k / 10));
    const a = nums(r.heard.asin);
    expect(a[0]).toBeCloseTo(-Math.PI / 2, 4);
    expect(a[20]).toBeCloseTo(Math.PI / 2, 4);
    const d = diffs(nums(r.heard['+ 66.0']).slice(0, 21));
    expect(d[0]).toBeGreaterThan(3 * d[10]);
    expect(d[19]).toBeGreaterThan(3 * d[10]);
  });
});

describe('asinh/0: Opening a filter', () => {
  it('"from 200 Hz the sound brightens quickly, then more and more slowly"', async () => {
    const r = await go('asinh', 0, { seconds: 3.1, listen: [{ box: '+ 200.0' }] });
    const cut = nums(r.heard['+ 200.0']).slice(0, 16);
    closeTo(cut, range(0, 15).map((k) => 200 + 500 * Math.asinh(20 * k)), 2);
    expect(cut[0]).toBe(200);
    const d = diffs(cut);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThan(d[i - 1]);
    // the filter really opens: more harmonics get through late than early
    expect(bright(r.left, 2.7, 2.95)).toBeGreaterThan(2 * bright(r.left, 0.05, 0.19));
    expect(rms(r.left, 2.7, 2.95)).toBeGreaterThan(rms(r.left, 0.05, 0.19));
  });
  it.fails('BUG: "up to about 3000 Hz": the cutoff tops out at 200 + 500*asinh(300) = 3398 Hz (code comment "0 .. 5.7" is also wrong: asinh(300) = 6.40)', async () => {
    const r = await go('asinh', 0, { seconds: 3.1, listen: [{ box: '+ 200.0' }] });
    expect(Math.abs(Math.max(...nums(r.heard['+ 200.0'])) - 3000)).toBeLessThan(150);
  });
});

describe('atan/0: A leap that levels off', () => {
  it('"For 0..15 it shoots up from 0 then flattens near 1.5, so the melody leaps from note 54 and then barely moves"', async () => {
    const r = await go('atan', 0, { seconds: 2.9, listen: [{ box: 'atan' }, { box: '+ 54.0' }] });
    const a = nums(r.heard.atan).slice(0, 16);
    closeTo(a, range(0, 15).map(Math.atan));
    expect(a[15]).toBeCloseTo(1.5, 1);
    const n = nums(r.heard['+ 54.0']);
    expect(n[0]).toBe(54);
    expect(n[1] - n[0]).toBeGreaterThan(12);           // 16 * π/4 = 12.6 semitones
    expect(n[15] - n[14]).toBeLessThan(0.1);
  });
});

describe('atan2/0: An S-shaped sweep', () => {
  it('"With x = 2 and y counting -8..8, the angle climbs slowly, rushes through the middle, and slows again"', async () => {
    const r = await go('atan2', 0, { seconds: 2.6, listen: [{ box: 'atan2' }] });
    const a = nums(r.heard.atan2).slice(0, 17);
    closeTo(a, range(-8, 8).map((y) => Math.atan2(y, 2)));
    const d = diffs(a);
    expect(d[8]).toBeGreaterThan(5 * d[0]);
    expect(d[7]).toBeGreaterThan(5 * d[15]);
  });
  it('"larger values smooth the curve": x = 10 from the number box makes the middle step smaller', async () => {
    const r = await go('atan2', 0, { seconds: 2.6, listen: [{ box: 'atan2' }], actions: [{ t: 0.005, box: 'number', msg: [10] }] });
    const a = nums(r.heard.atan2);
    closeTo(a.slice(1, 17), range(-7, 8).map((y) => Math.atan2(y, 10)));
  });
  it.fails('BUG (text): "0 jumps between two notes": with x = 0, y = 0 gives atan2(0,0) = 0, a third (middle) note once per cycle', async () => {
    const r = await go('atan2', 0, { seconds: 2.6, listen: [{ box: 'atan2' }], actions: [{ t: 0.005, box: 'number', msg: [0] }] });
    const distinct = new Set(nums(r.heard.atan2).slice(1).map((v) => v.toFixed(4)));
    expect(distinct.size).toBe(2);
  });
});

describe('atanh/0: Racing toward the edges', () => {
  it('"-0.9 .. 0.9 in even steps becomes a pitch that leaps at both ends and drifts through the middle"', async () => {
    const r = await go('atanh', 0, { seconds: 2.9, listen: [{ box: 'scale' }, { box: 'atanh' }] });
    closeTo(nums(r.heard.scale), range(0, 18).map((k) => -0.9 + 0.1 * k));
    const a = nums(r.heard.atanh).slice(0, 19);
    closeTo(a, range(0, 18).map((k) => Math.atanh(-0.9 + 0.1 * k)));
    const d = diffs(a);
    expect(d[0]).toBeGreaterThan(3 * d[9]);
    expect(d[17]).toBeGreaterThan(3 * d[9]);
  });
});

describe('atodb/0: Hearing the decibel curve', () => {
  it('"Amplitudes 1/16 .. 16/16 become -24 .. 0 dB, played as notes 60..84: the pitch jumps up at first and creeps at the end"', async () => {
    const r = await go('atodb', 0, { seconds: 3, listen: [{ box: 'atodb' }, { box: '+ 84.0' }] });
    const db = nums(r.heard.atodb).slice(0, 16);
    closeTo(db, range(1, 16).map((k) => 20 * Math.log10(k / 16)));
    expect(db[0]).toBeCloseTo(-24, 0);
    expect(db[15]).toBeCloseTo(0, 6);
    const n = nums(r.heard['+ 84.0']);
    expect(n[0]).toBeCloseTo(60, 0);
    expect(n[15]).toBeCloseTo(84, 6);
    const d = diffs(n.slice(0, 16));
    expect(d[0]).toBeGreaterThan(10 * d[14]);
    expect(noteHz(r.left, 0.18 * 15, 0.18)).toBeCloseTo(mtof(84), -1);
  });
});

describe('cos/0: A slow tremolo', () => {
  it('"Sixteen steps make one turn ... a volume from 1 down to 0 and back, so the tone fades out and in"', async () => {
    const r = await go('cos', 0, { seconds: 2.2, listen: [{ box: '+ 0.5' }] });
    const v = nums(r.heard['+ 0.5']).slice(0, 16);
    closeTo(v, range(0, 15).map((k) => 0.5 + 0.5 * Math.cos(0.3927 * k)), 3);
    expect(v[0]).toBeCloseTo(1, 6);
    expect(v[8]).toBeCloseTo(0, 4);
    const at = (k: number) => rms(r.left, k * 0.12 + 0.01, k * 0.12 + 0.11);
    expect(at(0)).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(at(8)).toBeLessThan(0.001);
    expect(at(4)).toBeCloseTo(0.5 * 0.2 / Math.SQRT2, 2);
    expect(at(15)).toBeGreaterThan(at(12));
    expect(noteHz(r.left, 0, 0.12)).toBeCloseTo(262, -1);
  });
});

describe('cosh/0: A smooth U-turn', () => {
  it('"Inputs -2 .. 2 give a pitch that falls fast, slows to 200 Hz at the bottom, and climbs back to 750 Hz"', async () => {
    const r = await go('cosh', 0, { seconds: 2.6, listen: [{ box: '/ 4.0' }, { box: '* 200.0' }] });
    closeTo(nums(r.heard['/ 4.0']), range(-8, 8).map((k) => k / 4));
    const hz = nums(r.heard['* 200.0']).slice(0, 17);
    closeTo(hz, range(-8, 8).map((k) => 200 * Math.cosh(k / 4)), 3);
    expect(hz[8]).toBe(200);
    expect(hz[16]).toBeCloseTo(750, -1);
    expect(noteHz(r.left, 0, 0.15)).toBeCloseTo(752.4, -1);
    expect(noteHz(r.left, 8 * 0.15, 0.15)).toBeCloseTo(200, -1);
  });
});

describe('dbtoa/0: An even fade in decibels', () => {
  it('"Steps of -3 dB (0, -3 ... -36) make a fade that sounds even all the way down, then the tone starts loud again"', async () => {
    const r = await go('dbtoa', 0, { seconds: 2.8, listen: [{ box: '* -3' }, { box: 'dbtoa' }] });
    expect(nums(r.heard['* -3']).slice(0, 13)).toEqual(range(0, 12).map((k) => -3 * k));
    closeTo(nums(r.heard.dbtoa), range(0, 12).map((k) => 10 ** (-3 * k / 20)));
    const lv = range(0, 13).map((k) => rms(r.left, k * 0.2 + 0.02, k * 0.2 + 0.18));
    expect(lv[0]).toBeCloseTo(0.2 / Math.SQRT2, 2);
    for (let k = 1; k <= 12; k++) expect(lv[k] / lv[k - 1]).toBeCloseTo(10 ** (-3 / 20), 2);
    expect(lv[13]).toBeCloseTo(0.2 / Math.SQRT2, 2);       // counter wraps: loud again
  });
});

describe('div/0: Dividing a number', () => {
  it('"counter\'s 0..15 divided by 15. gives 0 to 1 in sixteen steps, used as the volume of a 220 Hz tone: it swells, then starts again"', async () => {
    const r = await go('div', 0, { seconds: 2.6, listen: [{ box: '/ 15.0' }] });
    closeTo(nums(r.heard['/ 15.0']), range(0, 15).map((k) => k / 15));
    const lv = (k: number) => rms(r.left, k * 0.15 + 0.02, k * 0.15 + 0.13);
    expect(lv(0)).toBeLessThan(0.001);
    expect(lv(15)).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(lv(7)).toBeCloseTo((7 / 15) * 0.2 / Math.SQRT2, 2);
    expect(lv(16)).toBeLessThan(0.001);                      // starts again
    expect(noteHz(r.left, 15 * 0.15, 0.15)).toBeCloseTo(220, -1);
  });
  it.fails('BUG engine: "/ 15 would give only 0 or 1" (true in Max: int argument = int division), but the engine\'s / always divides as floats',  async () => {
    const r = await go('div', 0, { seconds: 2.5, listen: [{ box: '/ 15' }], edit: replaceText('/ 15.0', '/ 15') });
    expect(new Set(nums(r.heard['/ 15']))).toEqual(new Set([0, 1]));
  });
});

describe('div/1: Dividing a harmonic series', () => {
  it('"Multiples of 330 Hz divided by 4. play the harmonics of 82.5 Hz, climbing from low to high"', async () => {
    const r = await go('div', 1, { seconds: 3.3, listen: [{ box: 'div' }] });
    closeTo(nums(r.heard.div), range(1, 16).map((k) => 82.5 * k));
    expect(noteHz(r.left, 0, 0.2)).toBeCloseTo(82.5, 0);
    expect(noteHz(r.left, 0.2, 0.2)).toBeCloseTo(165, 0);
  });
  it('"drag the number box to change the divisor: a bigger number moves the whole series lower" (cold: from the next note)', async () => {
    const r = await go('div', 1, { seconds: 1.1, listen: [{ box: 'div' }], actions: [{ t: 0.41, box: 'number', msg: [8] }] });
    closeTo(nums(r.heard.div), [82.5, 165, 247.5, 1320 / 8, 1650 / 8]);
  });
});

describe('expr/0: Math written as a formula', () => {
  it('"$i1 * 7 % 12 + 60" turns a count into notes a fifth apart, folded into one octave', async () => {
    const r = await go('expr', 0, { seconds: 2.7, listen: [{ box: 'expr' }] });
    const n = nums(r.heard.expr).slice(0, 12);
    expect(n).toEqual([60, 67, 62, 69, 64, 71, 66, 61, 68, 63, 70, 65]);
    diffs(n).forEach((d) => expect(((d % 12) + 12) % 12).toBe(7));
    expect(new Set(n).size).toBe(12);
    expect(noteHz(r.left, 0.22, 0.22)).toBeCloseTo(mtof(67), -1);
  });
});

describe('ftom/0: Tuning random frequencies', () => {
  it('"ftom turns a frequency into the nearest MIDI note ... ftom then mtof snaps each one to a piano key"', async () => {
    const r = await go('ftom', 0, { seconds: 3, listen: [{ box: '+ 200' }, { box: 'ftom' }, { box: 'mtof' }] });
    const raw = nums(r.heard['+ 200']), n = nums(r.heard.ftom), hz = nums(r.heard.mtof);
    expect(raw.length).toBeGreaterThan(10);
    raw.forEach((f) => { expect(f).toBeGreaterThanOrEqual(200); expect(f).toBeLessThanOrEqual(799); });
    raw.forEach((f, i) => {
      expect(Number.isInteger(n[i])).toBe(true);                         // Max: whole numbers by default
      expect(n[i]).toBe(Math.round(69 + 12 * Math.log2(f / 440)));       // the nearest key
      expect(hz[i]).toBeCloseTo(mtof(n[i]), 4);
    });
    expect(noteHz(r.left, 0, 0.2)).toBeCloseTo(hz[0], -1);
  });
});

describe('maximum/0: A floor under the melody', () => {
  it('"Random notes 48..71 that fall below 60 come out as 60"', async () => {
    const r = await go('maximum', 0, { seconds: 4, listen: [{ box: '+ 48' }, { box: 'maximum' }] });
    const inn = nums(r.heard['+ 48']), out = nums(r.heard.maximum);
    expect(inn.some((x) => x < 60)).toBe(true);
    inn.forEach((x) => { expect(x).toBeGreaterThanOrEqual(48); expect(x).toBeLessThanOrEqual(71); });
    expect(out).toEqual(inn.map((x) => Math.max(x, 60)));
  });
});

describe('mean/0: A melody that settles', () => {
  it('"Random notes 60..83 play in the left ear; their running mean plays in the right, wandering at first and settling near note 71.5"', async () => {
    const r = await go('mean', 0, { seconds: 15, listen: [{ box: '+ 60' }, { box: 'mean' }] });
    const n = nums(r.heard['+ 60']), m = nums(r.heard.mean);
    let s = 0;
    n.forEach((x, i) => { s += x; expect(m[i]).toBeCloseTo(s / (i + 1), 6); });
    expect(Math.abs(m.at(-1)! - 71.5)).toBeLessThan(2.5);
    expect(noteHz(r.left, 0.25, 0.25)).toBeCloseTo(mtof(n[1]), -1);
    expect(noteHz(r.right, 0.25, 0.25)).toBeCloseTo(mtof(m[1]), -1);
  });
});

describe('minimum/0: A ceiling over the melody', () => {
  it('"The scale climbs 60..75, but minimum 70 stops it at note 70, which repeats until the counter starts again"', async () => {
    const r = await go('minimum', 0, { seconds: 2.8, listen: [{ box: 'minimum' }] });
    expect(nums(r.heard.minimum).slice(0, 17)).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 70, 70, 70, 70, 70, 60]);
  });
});

describe('minus/1: Transposing down', () => {
  it('"The counter plays notes 72..79, and minus 12 moves them an octave down"', async () => {
    const r = await go('minus', 1, { seconds: 1.7, listen: [{ box: 'minus' }] });
    expect(nums(r.heard.minus).slice(0, 8)).toEqual(range(60, 67));
    expect(noteHz(r.left, 0, 0.2)).toBeCloseTo(mtof(60), -1);
  });
  it('"drag the number box to transpose by a different interval"', async () => {
    const r = await go('minus', 1, { seconds: 0.9, listen: [{ box: 'minus' }], actions: [{ t: 0.31, box: 'number', msg: [7] }] });
    expect(nums(r.heard.minus).slice(0, 4)).toEqual([60, 61, 74 - 7, 75 - 7]);
  });
});

describe('modulo/0: Wrapping a count into a loop', () => {
  it('"% 5 becomes 0 1 2 3 4 0 1 2 ..., a five-note whole-tone loop"', async () => {
    const r = await go('modulo', 0, { seconds: 2.2, listen: [{ box: '%' }, { box: '+ 60' }] });
    expect(nums(r.heard['%']).slice(0, 12)).toEqual([0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1]);
    expect(nums(r.heard['+ 60']).slice(0, 5)).toEqual([60, 62, 64, 66, 68]);
  });
  it('"drag the number box to change the loop length"', async () => {
    const r = await go('modulo', 0, { seconds: 1.5, listen: [{ box: '%' }], actions: [{ t: 0.005, box: 'number', msg: [3] }] });
    expect(nums(r.heard['%']).slice(1, 8)).toEqual([1, 2, 0, 1, 2, 0, 1]);
  });
});

describe('modulo/1: Folding notes into one octave', () => {
  it('"Random notes 0..36 ... modulo 12 keeps only the note name, so every note lands in the octave above middle C"', async () => {
    const r = await go('modulo', 1, { seconds: 4, listen: [{ box: 'random' }, { box: '+ 60' }] });
    const raw = nums(r.heard.random), n = nums(r.heard['+ 60']);
    raw.forEach((x) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(36); });
    expect(Math.max(...raw)).toBeGreaterThan(12);
    expect(n).toEqual(raw.map((x) => 60 + (x % 12)));
  });
});

describe('mtof/0: MIDI note to frequency', () => {
  it('"60 is middle C (261.6 Hz), 69 is A (440 Hz). counter steps through 60..67"', async () => {
    const r = await go('mtof', 0, { seconds: 2.5, listen: [{ box: 'counter' }, { box: 'mtof' }] });
    expect(nums(r.heard.counter).slice(0, 9)).toEqual([...range(60, 67), 60]);
    expect(nums(r.heard.mtof)[0]).toBeCloseTo(261.63, 2);
    gaps(r.heard.mtof).forEach((g) => expect(g).toBeCloseTo(0.3, 1));
    expect(noteHz(r.left, 0, 0.3)).toBeCloseTo(261.6, -1);
    expect(mtof(69)).toBe(440);
  });
});

describe('+/0: Adding to a number', () => {
  it('"counter makes 0..7; + 60 moves that up to the notes from middle C"', async () => {
    const r = await go('+', 0, { seconds: 2.1, listen: [{ box: '+' }] });
    expect(nums(r.heard['+']).slice(0, 8)).toEqual(range(60, 67));
    expect(noteHz(r.left, 0, 0.25)).toBeCloseTo(261.6, -1);
  });
});

describe('pow/0: Raising to a power', () => {
  it('"0..6 squared is 0, 1, 4, 9, 16, 25, 36: above note 48, each step of the melody is wider than the last"', async () => {
    const r = await go('pow', 0, { seconds: 1.8, listen: [{ box: 'pow' }, { box: '+ 48' }] });
    expect(nums(r.heard.pow).slice(0, 7)).toEqual([0, 1, 4, 9, 16, 25, 36]);
    expect(nums(r.heard['+ 48']).slice(0, 7)).toEqual([48, 49, 52, 57, 64, 73, 84]);
  });
});

describe('rdiv/0: The undertone series', () => {
  it('"1760 / 1, 1760 / 2, 1760 / 3 ... falls in ever smaller steps, from 1760 Hz down to 220 Hz"', async () => {
    const r = await go('rdiv', 0, { seconds: 2.1, listen: [{ box: '!/' }] });
    closeTo(nums(r.heard['!/']), range(1, 8).map((k) => 1760 / k));
    expect(noteHz(r.left, 0, 0.25)).toBeCloseTo(1760, -2);
    expect(noteHz(r.left, 7 * 0.25, 0.25)).toBeCloseTo(220, -1);
  });
});

describe('rdiv/1: From period to frequency', () => {
  it('"rdiv 1000. turns the periods into 500 Hz down to 111 Hz"', async () => {
    const r = await go('rdiv', 1, { seconds: 1.7, listen: [{ box: 'rdiv' }] });
    closeTo(nums(r.heard.rdiv), range(2, 9).map((k) => 1000 / k));
    expect(noteHz(r.left, 0, 0.2)).toBeCloseTo(500, -1);
    expect(noteHz(r.left, 1.4, 0.2)).toBeCloseTo(111.1, 0);
  });
});

describe('rminus/0: Subtracting from a number', () => {
  it('"72 - 0, 72 - 1, ... 72 - 12. A rising counter becomes a falling chromatic scale"', async () => {
    const r = await go('rminus', 0, { seconds: 2.2, listen: [{ box: '!-' }] });
    expect(nums(r.heard['!-']).slice(0, 13)).toEqual(range(0, 12).map((k) => 72 - k));
  });
});

describe('rminus/1: Turning an arpeggio upside down', () => {
  it('"0, 3, 6 ... 21 counted up in minor thirds; rminus 84 gives 84 minus each"', async () => {
    const r = await go('rminus', 1, { seconds: 1.8, listen: [{ box: '* 3' }, { box: 'rminus' }] });
    expect(nums(r.heard['* 3']).slice(0, 8)).toEqual(range(0, 7).map((k) => 3 * k));
    expect(nums(r.heard.rminus).slice(0, 8)).toEqual(range(0, 7).map((k) => 84 - 3 * k));
    expect(noteHz(r.left, 0, 0.22)).toBeCloseTo(mtof(84), -1);
  });
});

describe('round/0: Snapping to a grid', () => {
  const near = (x: number, m: number) => Math.round(x / m) * m;
  it('"A chromatic climb 0..23 rounded to multiples of 3 becomes a staircase of minor thirds above note 60"', async () => {
    const r = await go('round', 0, { seconds: 3.7, listen: [{ box: 'round' }] });
    expect(nums(r.heard.round).slice(0, 24)).toEqual(range(0, 23).map((k) => near(k, 3)));
  });
  it('"drag the number box to change the step: 1 is chromatic, 4 major thirds, 7 fifths"', async () => {
    for (const step of [1, 4, 7]) {
      const r = await go('round', 0, { seconds: 3.7, listen: [{ box: 'round' }], actions: [{ t: 0.005, box: 'number', msg: [step] }] });
      expect(nums(r.heard.round).slice(1, 24), `step ${step}`).toEqual(range(1, 23).map((k) => near(k, step)));
    }
  });
});

describe('scale/0: Map one range to another', () => {
  it('"scale maps 0..15 onto 48..72 ... a counter\'s 16 steps become a two-octave climb"', async () => {
    const r = await go('scale', 0, { seconds: 2, listen: [{ box: 'scale' }] });
    const n = nums(r.heard.scale).slice(0, 16);
    expect(n[0]).toBe(48);
    expect(n[15]).toBe(72);
    diffs(n).forEach((d) => expect(d).toBeGreaterThan(0));
  });
  it.fails('BUG engine: with all-int arguments Max\'s scale outputs truncated ints (maxref: "output values are truncated rather than rounded"); the engine outputs floats (48, 49.6, 51.2 ...)', async () => {
    const r = await go('scale', 0, { seconds: 2, listen: [{ box: 'scale' }] });
    expect(nums(r.heard.scale).slice(0, 16)).toEqual(range(0, 15).map((k) => Math.trunc(48 + (k * 24) / 15)));
  });
});

describe('sin/0: A melody shaped like a sine wave', () => {
  it('"Counting 0..31 in steps of 2π/32 makes one full turn, so the pitch rises and falls smoothly around note 66"', async () => {
    const r = await go('sin', 0, { seconds: 3.3, listen: [{ box: 'sin' }, { box: '+ 66.0' }] });
    closeTo(nums(r.heard.sin), range(0, 31).map((k) => Math.sin(0.19635 * k)), 4);
    const n = nums(r.heard['+ 66.0']).slice(0, 32);
    closeTo(n, range(0, 31).map((k) => 66 + 12 * Math.sin(0.19635 * k)), 3);
    expect(Math.max(...n)).toBeCloseTo(78, 3);
    expect(Math.min(...n)).toBeCloseTo(54, 3);
  });
  it('"drag the number box to set how many semitones it swings"', async () => {
    const r = await go('sin', 0, { seconds: 3.3, listen: [{ box: '+ 66.0' }], actions: [{ t: 0.005, box: 'number', msg: [5] }] });
    const n = nums(r.heard['+ 66.0']).slice(1, 32);
    expect(Math.max(...n)).toBeCloseTo(71, 3);
    expect(Math.min(...n)).toBeCloseTo(61, 3);
  });
});

describe('sinh/0: A slow start, then a rocket', () => {
  it('"Inputs 0 .. 3 give 0 .. 10, heard as 200 .. 600 Hz: barely moving at first, then racing upward"', async () => {
    const r = await go('sinh', 0, { seconds: 2.5, listen: [{ box: 'sinh' }, { box: '+ 200.0' }] });
    const s = nums(r.heard.sinh).slice(0, 16);
    closeTo(s, range(0, 15).map((k) => Math.sinh(k / 5)));
    expect(s[15]).toBeCloseTo(10, 0);
    const hz = nums(r.heard['+ 200.0']).slice(0, 16);
    expect(hz[0]).toBe(200);
    expect(hz[15]).toBeCloseTo(600, -1);
    const d = diffs(hz);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
    expect(noteHz(r.left, 15 * 0.15, 0.15)).toBeCloseTo(600.7, -1);
  });
});

describe('sqrt/0: A square-root climb', () => {
  it('"220 Hz times the roots of 1..16 climbs from 220 to 880 Hz, in big steps at first and smaller and smaller ones after"', async () => {
    const r = await go('sqrt', 0, { seconds: 3.3, listen: [{ box: '* 220.0' }] });
    const hz = nums(r.heard['* 220.0']).slice(0, 16);
    closeTo(hz, range(1, 16).map((k) => 220 * Math.sqrt(k)), 3);
    expect(hz[15]).toBeCloseTo(880, 6);
    const d = diffs(hz);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThan(d[i - 1]);
    expect(noteHz(r.left, 0, 0.2)).toBeCloseTo(220, -1);
    expect(noteHz(r.left, 3.0, 0.2)).toBeCloseTo(880, -1);
  });
});

describe('tan/0: A sweep that speeds up', () => {
  it('"Angles 0 .. 1.35 give 0 .. 4.5, heard as 200 .. 645 Hz: the pitch creeps up, then shoots"', async () => {
    const r = await go('tan', 0, { seconds: 2.5, listen: [{ box: 'tan' }, { box: '+ 200.0' }] });
    const t = nums(r.heard.tan).slice(0, 16);
    closeTo(t, range(0, 15).map((k) => Math.tan(0.09 * k)));
    expect(t[15]).toBeCloseTo(4.5, 0);
    const hz = nums(r.heard['+ 200.0']).slice(0, 16);
    expect(hz[15]).toBeCloseTo(645, -1);
    const d = diffs(hz);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
  });
});

describe('tanh/0: A swell that saturates', () => {
  it('"Used as a volume, 0 .. 5 makes the tone swell quickly and then hold, never going past full level"', async () => {
    const r = await go('tanh', 0, { seconds: 2.4, listen: [{ box: 'tanh' }] });
    const v = nums(r.heard.tanh).slice(0, 16);
    closeTo(v, range(0, 15).map((k) => Math.tanh(k / 3)));
    v.forEach((x) => expect(x).toBeLessThan(1));
    expect(v[5]).toBeGreaterThan(0.9);
    const lv = (k: number) => rms(r.left, k * 0.15 + 0.02, k * 0.15 + 0.13);
    expect(lv(0)).toBeLessThan(0.001);
    expect(lv(15)).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(lv(8)).toBeGreaterThan(0.95 * lv(15));
    expect(peak(r.left)).toBeLessThanOrEqual(0.2001);
  });
});

describe('*/0: Multiplying a number', () => {
  it('"0, 1, 2, 3 times 7 gives 0, 7, 14, 21, a chain of fifths above note 48"', async () => {
    const r = await go('*', 0, { seconds: 1.3, listen: [{ box: '* 7' }, { box: '+ 48' }] });
    expect(nums(r.heard['* 7']).slice(0, 4)).toEqual([0, 7, 14, 21]);
    expect(nums(r.heard['+ 48']).slice(0, 4)).toEqual([48, 55, 62, 69]);
    expect(noteHz(r.left, 0.9, 0.3)).toBeCloseTo(440, -1);
  });
});

describe('zmap/0: Map a range, and hold the ends', () => {
  it('"counts 0..3 all play 60 and 12..15 all play 74 ... a hold, a whole-tone climb, then a hold at the top"', async () => {
    const r = await go('zmap', 0, { seconds: 2.5, listen: [{ box: 'zmap' }] });
    expect(nums(r.heard.zmap).slice(0, 16)).toEqual([60, 60, 60, 60, 60, 62, 64, 66, 68, 70, 72, 74, 74, 74, 74, 74]);
  });
});

// ═══ Signal analysis ═══
// To compare what an analysis object reports with the signal it really got, `tapRight`
// sends that signal (unscaled) to ezdac~'s right channel instead of the mix.

/** Edit: feed box `id` outlet 0 into ezdac~'s right inlet in place of whatever fed it. */
const tapRight = (id: string) => (p: any) => {
  const dac = p.patcher.boxes.find((b: any) => b.box.maxclass === 'ezdac~').box.id;
  p.patcher.lines = p.patcher.lines.filter((l: any) => !(l.patchline.destination[0] === dac && l.patchline.destination[1] === 1));
  p.patcher.lines.push({ patchline: { source: [id, 0], destination: [dac, 1] } });
};
const meanAbs = (x: Float32Array, t0: number, t1: number) => {
  const s = x.subarray(Math.max(0, Math.round(t0 * SR)), Math.round(t1 * SR));
  let a = 0; for (const v of s) a += Math.abs(v);
  return a / Math.max(1, s.length);
};
function corr(a: number[], b: number[]) {
  const n = a.length, ma = a.reduce((x, y) => x + y) / n, mb = b.reduce((x, y) => x + y) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
}

describe('cycle~ (used by avg~, edge~, meter~, peakamp~, snapshot~, thresh~ examples)', () => {
  it.fails('BUG engine: cycle~ is a sine OscillatorNode; Max\'s cycle~ is a cosine table, so it starts at 1, not 0', async () => {
    const r = await go('edge~', 0, { seconds: 0.3, edit: tapRight('obj-1') });   // obj-1 = cycle~ 1
    expect(r.right[1]).toBeCloseTo(1, 2);
    expect(r.right[Math.round(0.25 * SR)]).toBeCloseTo(0, 2);
  });
});

describe('avg~/0: A second voice that follows the level', () => {
  it('"metro asks ten times a second ... the answer sets a second tone\'s pitch: it slides up as the first gets louder"', async () => {
    const r = await go('avg~', 0, { seconds: 2.5, edit: tapRight('obj-5'), listen: [{ box: 'avg~' }, { box: 'scale' }] });
    const h = r.heard['avg~'].slice(1);
    gaps(h).forEach((g) => expect(g).toBeCloseTo(0.1, 1));
    const level = h.map((x) => meanAbs(r.right, x.t - 0.1, x.t));
    expect(corr(nums(h), level)).toBeGreaterThan(0.97);              // follows the level
    const s = r.heard.scale.slice(1);
    s.forEach((x, i) => expect(Number(x.msg[0])).toBeCloseTo(330 + 800 * Number(h[i].msg[0]), 3));
    const loud = h.reduce((b, _x, i) => (level[i] > level[b] ? i : b), 0), quiet = h.reduce((b, _x, i) => (level[i] < level[b] ? i : b), 0);
    expect(Number(s[loud].msg[0]) - Number(s[quiet].msg[0])).toBeGreaterThan(400);
  });
  it.fails('BUG engine: avg~ reports RMS of the last 1024 samples, not Max\'s "average (absolute) amplitude ... since the previous bang"', async () => {
    const r = await go('avg~', 0, { seconds: 2.5, edit: tapRight('obj-5'), listen: [{ box: 'avg~' }] });
    for (const x of r.heard['avg~'].slice(1)) expect(Math.abs(Number(x.msg[0]) - meanAbs(r.right, x.t - 0.1, x.t))).toBeLessThan(0.02);
  });
});

describe('edge~/0: Two notes from one switch', () => {
  it('"bangs its left outlet when a signal turns non-zero and its right outlet when it returns to zero ... alternate the tone between 660 and 440 Hz"', async () => {
    const r = await go('edge~', 0, { seconds: 3.2, listen: [{ box: 'edge~', outlet: 0, label: 'on' }, { box: 'edge~', outlet: 1, label: 'off' }] });
    const ev = [...r.heard.on.map((x) => ({ t: x.t, k: 'on' })), ...r.heard.off.map((x) => ({ t: x.t, k: 'off' }))].sort((a, b) => a.t - b.t);
    expect(ev.length).toBeGreaterThanOrEqual(5);
    ev.forEach((e, i) => expect(e.k).toBe(i % 2 === 0 ? 'on' : 'off'));
    gaps(r.heard.on).forEach((g) => expect(g).toBeCloseTo(1, 1));       // 1 Hz switch
    for (const e of ev.slice(0, -1)) {
      const next = ev[ev.indexOf(e) + 1].t;
      expect(pitch(r.left, e.t + 0.03, Math.min(next, e.t + 0.3)), `${e.k} at ${e.t}`).toBeCloseTo(e.k === 'on' ? 660 : 440, -1);
    }
  });
  it.fails('BUG engine (Max timing): from a cosine at 1, thresh~ is on at once and off at 0.25 s, so the first right-outlet bang is at 0.25 s', async () => {
    const r = await go('edge~', 0, { seconds: 1.0, listen: [{ box: 'edge~', outlet: 0, label: 'on' }, { box: 'edge~', outlet: 1, label: 'off' }] });
    expect(r.heard.on[0].t).toBeLessThan(0.02);
    expect(r.heard.off[0].t).toBeCloseTo(0.25, 1);
  });
});

describe('meter~/0: Watch a level move', () => {
  it('"reports the peak of the signal coming in ... * 127 turns the 0..1 peak into a position for the slider, which rises and falls with it"', async () => {
    const r = await go('meter~', 0, { seconds: 4.1, edit: tapRight('obj-5'), listen: [{ box: 'meter~' }, { box: '* 127.0' }] });
    const h = r.heard['meter~'].slice(1);
    expect(h.length).toBeGreaterThan(5);
    expect(corr(nums(h), h.map((x) => peak(r.right, x.t - 0.05, x.t)))).toBeGreaterThan(0.95);
    nums(h).forEach((v) => expect(v).toBeLessThanOrEqual(1.0001));
    const s = nums(r.heard['* 127.0']);
    nums(r.heard['meter~']).forEach((v, i) => expect(s[i]).toBeCloseTo(127 * v, 4));
    expect(Math.max(...s)).toBeGreaterThan(110);
    expect(Math.min(...s)).toBeLessThan(15);
  });
  it.fails('BUG engine: meter~ reports every 250 ms; Max\'s default interval is 50 ms (and the peak should cover the whole interval)', async () => {
    const r = await go('meter~', 0, { seconds: 1.5, edit: tapRight('obj-5'), listen: [{ box: 'meter~' }] });
    const g = gaps(r.heard['meter~']);
    expect(g.reduce((a, b) => a + b, 0) / g.length).toBeCloseTo(0.05, 2);
    for (const x of r.heard['meter~'].slice(1)) expect(Number(x.msg[0])).toBeCloseTo(peak(r.right, x.t - 0.05, x.t), 2);
  });
});

describe('number~/0: A ramp read out as notes', () => {
  const wrapDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); };
  it('"sends it out its right outlet as a number, ten times a second ... a pitch that climbs in steps from 200 to 600 Hz every two seconds"', async () => {
    const r = await go('number~', 0, { seconds: 4.2, listen: [{ box: 'number~', outlet: 1 }, { box: '+ 200.0' }] });
    const h = r.heard['number~'];
    const g = gaps(h);
    expect(g.reduce((a, b) => a + b, 0) / g.length).toBeCloseTo(0.1, 2);
    for (const x of h) expect(wrapDiff(Number(x.msg[0]), x.t * 0.5)).toBeLessThan(0.05);
    const hz = r.heard['+ 200.0'];
    expect(Math.min(...nums(hz))).toBeLessThan(230);
    expect(Math.max(...nums(hz))).toBeGreaterThan(570);
    const mid = hz.find((x) => x.t > 1.45)!;
    expect(pitch(r.left, mid.t + 0.02, mid.t + 0.09)).toBeCloseTo(Number(mid.msg[0]), -1);
    const drop = hz.findIndex((x, i) => i > 0 && Number(x.msg[0]) < Number(hz[i - 1].msg[0]));
    expect(hz[drop].t).toBeGreaterThan(1.99); expect(hz[drop].t).toBeLessThan(2.16);                     // back to 200 every two seconds
  });
  it.fails('BUG engine: analysis taps (number~, snapshot~) report the sample from ~46 ms ago (buf[0] of a 2048-sample AnalyserNode window read into a 1024 buffer)', async () => {
    const r = await go('number~', 0, { seconds: 1.5, listen: [{ box: 'number~', outlet: 1 }] });
    for (const x of r.heard['number~']) expect(wrapDiff(Number(x.msg[0]), x.t * 0.5)).toBeLessThan(0.005);
  });
});

describe('peakamp~/0: Louder is brighter', () => {
  it('"peakamp~ 50 reports the loudest sample it heard every 50 ms ... its peak, times 3000, sets lores~\'s cutoff: the filter opens as the sound gets louder"', async () => {
    const r = await go('peakamp~', 0, { seconds: 2.5, edit: tapRight('obj-5'), listen: [{ box: 'peakamp~' }, { box: '+ 200.0' }] });
    const h = r.heard['peakamp~'];
    const g = gaps(h);
    expect(g.reduce((a, b) => a + b, 0) / g.length).toBeCloseTo(0.05, 2);
    const hs = h.slice(1);
    expect(corr(nums(hs), hs.map((x) => peak(r.right, x.t - 0.05, x.t)))).toBeGreaterThan(0.97);
    const c = nums(r.heard['+ 200.0']);
    h.forEach((x, i) => expect(c[i]).toBeCloseTo(200 + 3000 * Number(x.msg[0]), 3));
    // the filter opens: loudest moment brighter than quietest (both measured on the mix)
    const loud = hs.reduce((b, x) => (Number(x.msg[0]) > Number(b.msg[0]) ? x : b)), quiet = hs.reduce((b, x) => (Number(x.msg[0]) < Number(b.msg[0]) && Number(x.msg[0]) > 0.15 ? x : b), loud);
    expect(bright(r.left, loud.t, loud.t + 0.05)).toBeGreaterThan(1.5 * bright(r.left, quiet.t, quiet.t + 0.05));
  });
  it.fails('BUG engine: peakamp~ only scans one 1024-sample window per report, not every sample since the last report', async () => {
    const r = await go('peakamp~', 0, { seconds: 2.5, edit: tapRight('obj-5'), listen: [{ box: 'peakamp~' }] });
    for (const x of r.heard['peakamp~'].slice(1)) expect(Number(x.msg[0])).toBeCloseTo(peak(r.right, x.t - 0.05, x.t), 2);
  });
});

describe('snapshot~/0: Audio to numbers', () => {
  it('"samples a signal as a number, here every 125 ms. A slow sine becomes a stepping melody: scale maps -1..1 to MIDI notes 60..72"', async () => {
    const r = await go('snapshot~', 0, { seconds: 5.2, edit: tapRight('obj-1'), listen: [{ box: 'snapshot~' }, { box: 'scale' }] });
    const h = r.heard['snapshot~'];
    gaps(h).forEach((g) => expect(g).toBeCloseTo(0.125, 1));
    for (const x of h.slice(1)) expect(Number(x.msg[0])).toBeCloseTo(r.right[Math.round(x.t * SR)], 0);
    const n = nums(r.heard.scale);
    n.forEach((x, i) => expect(x).toBeCloseTo(66 + 6 * Number(h[i].msg[0]), 0));
    expect(Math.max(...n)).toBeGreaterThan(71);
    expect(Math.min(...n)).toBeLessThan(61);
  });
  it.fails('BUG engine: "scale -1 1 60 72" has all-int arguments, so in Max it outputs truncated ints (maxref: "output values are truncated rather than rounded")', async () => {
    const r = await go('snapshot~', 0, { seconds: 2, listen: [{ box: 'snapshot~' }, { box: 'scale' }] });
    const s = nums(r.heard['snapshot~']), n = nums(r.heard.scale);
    n.forEach((x, i) => expect(x).toBe(Math.trunc(60 + (s[i] + 1) * 6)));
  });
});

describe('thresh~/0: Turn a slow wave into on and off', () => {
  /** Envelope of the output (peak per 1 ms) and the input LFO on the right channel. */
  const switches = (r: { left: Float32Array; right: Float32Array }) => {
    const out: { t: number; on: boolean; lfo: number }[] = [];
    let was = false;
    for (let i = 0; i + 44 < r.left.length; i += 44) {
      const on = peak(r.left, i / SR, (i + 44) / SR) > 0.1;
      if (on !== was) out.push({ t: i / SR, on, lfo: r.right[i] });
      was = on;
    }
    return out;
  };
  it('"Fed a 1 Hz sine, it switches a tone on and off; rampsmooth~ rounds each switch over 10 ms so it doesn\'t click"', async () => {
    const r = await go('thresh~', 0, { seconds: 3.1, edit: tapRight('obj-1') });
    const sw = switches(r);
    expect(sw.length).toBeGreaterThanOrEqual(5);
    sw.forEach((s, i) => expect(s.on).toBe(i % 2 === 0));
    gaps(sw.filter((s) => s.on).map((s) => ({ t: s.t, msg: [] }))).forEach((g) => expect(g).toBeCloseTo(1, 1));
    expect(noteHz(r.left, sw[2].t, 0.3)).toBeCloseTo(523, -1);
    // a switch-off ramps over ~10 ms: from 90% to 10% of full level takes about 8 ms
    const off = sw[3].t, env = (t: number) => peak(r.left, t, t + 0.002) / 0.2;
    let t90 = off - 0.03; while (env(t90) > 0.9) t90 += 0.0005;
    let t10 = t90; while (env(t10) > 0.1) t10 += 0.0005;
    expect(t10 - t90).toBeGreaterThan(0.005);
    expect(t10 - t90).toBeLessThan(0.012);
  });
  it.fails('BUG engine: thresh~ has no hysteresis (WaveShaper trips at (low+high)/2 = 0.25): Max turns on at input >= 0.5 and off at <= 0', async () => {
    const r = await go('thresh~', 0, { seconds: 3.1, edit: tapRight('obj-1') });
    for (const s of switches(r).slice(1)) {
      if (s.on) expect(s.lfo, `on at ${s.t}`).toBeGreaterThan(0.45);
      else expect(s.lfo, `off at ${s.t}`).toBeLessThan(0.05);
    }
  });
});

// ═══ Messages, lists, time ═══

describe('bondo/0: Keeping two voices in step', () => {
  it('"whenever any inlet gets a number, sends all of them out together ... melody stepping every 250 ms over a bass that changes once a second"', async () => {
    const r = await go('bondo', 0, { seconds: 4.1, listen: [{ box: 'bondo', outlet: 0, label: 'mel' }, { box: 'bondo', outlet: 1, label: 'bass' }, { box: '+ 64' }, { box: '+ 40' }] });
    const mel = r.heard.mel, bass = r.heard.bass;
    expect(mel.length).toBe(bass.length);                     // both outlets every time
    mel.forEach((m, i) => expect(bass[i].t).toBe(m.t));
    const inputs = r.heard['+ 64'].length + r.heard['+ 40'].length;
    expect(mel.length).toBe(inputs);
    // melody changes every 250 ms, bass every 1 s
    const changes = (h: Heard[]) => h.filter((x, i) => i > 0 && x.msg[0] !== h[i - 1].msg[0]).map((x) => x.t);
    expect(diffs(changes(mel)).every((g) => Math.abs(g - 0.25) < 0.02)).toBe(true);
    expect(diffs(changes(bass)).every((g) => Math.abs(g - 1) < 0.02)).toBe(true);
    expect(new Set(nums(bass).filter((x) => x !== 0))).toEqual(new Set([40, 42, 44, 46]));
  });
});

describe('bucket/0: A three-voice canon', () => {
  it('"each new step sends out what bucket already holds, so its three outlets play the same line one, two and three steps behind"', async () => {
    const r = await go('bucket', 0, { seconds: 3.3, listen: [{ box: '+ 48' }, ...[0, 1, 2].map((o) => ({ box: 'bucket', outlet: o, label: `o${o}` }))] });
    const inn = nums(r.heard['+ 48']);
    expect(inn.slice(0, 8)).toEqual(range(0, 7).map((k) => 48 + 5 * k));
    const o = [0, 1, 2].map((k) => nums(r.heard[`o${k}`]));
    for (let n = 3; n < inn.length; n++) {
      expect(o[0][n], `step ${n} outlet 0`).toBe(inn[n - 1]);
      expect(o[1][n], `step ${n} outlet 1`).toBe(inn[n - 2]);
      expect(o[2][n], `step ${n} outlet 2`).toBe(inn[n - 3]);
    }
    // "move together as a chord of fourths"
    expect(o[0][4] - o[1][4]).toBe(5);
    expect(o[1][4] - o[2][4]).toBe(5);
  });
});

describe('buddy/0: Waiting for both', () => {
  it('"sends everything out together only once every inlet has something ... only one note in five gets through, and the tone moves once a second"', async () => {
    const r = await go('buddy', 0, { seconds: 4.1, listen: [{ box: 'counter' }, { box: 'buddy' }] });
    const out = r.heard.buddy, steps = r.heard.counter;
    gaps(out).forEach((g) => expect(g).toBeCloseTo(1, 1));
    expect(out.length / steps.length).toBeCloseTo(1 / 5, 1);
    for (const x of out) {
      const last = steps.filter((s) => s.t <= x.t + 1e-9).at(-1)!;
      expect(x.msg[0]).toBe(last.msg[0]);
    }
  });
});

describe('date/0: Playing the clock', () => {
  it('"date answers the message time with the current hour, minute and second out its middle outlet ... climbs a semitone every second and drops back at the top of each minute"', async () => {
    const start = new Date(2026, 10, 20, 14, 37, 57, 500);
    const r = await go('date', 0, { seconds: 4.1, systemTime: start, listen: [{ box: 'date', outlet: 1 }, { box: '+ 36' }] });
    const t = r.heard.date;
    expect(t[0].msg).toEqual([14, 37, 57]);
    expect(t.map((x) => x.msg[2])).toEqual([57, 58, 59, 0, 1]);
    expect(nums(r.heard['+ 36'])).toEqual([93, 94, 95, 36, 37]);
    expect(noteHz(r.left, 3, 1)).toBeCloseTo(mtof(36), 0);
  });
});

describe('offer/0: Notes you can only take once', () => {
  it('"first four beats it quietly stores ... next four ... four rising plucks; ... the pairs are gone, so offer sends nothing and you hear silence"', async () => {
    const r = await go('offer', 0, { seconds: 3.7, listen: [{ box: 'offer' }, { box: 'counter' }] });
    const o = r.heard.offer;
    expect(nums(o)).toEqual([60, 64, 68, 72]);
    o.forEach((x, i) => expect(x.t).toBeCloseTo(0.3 * (4 + i), 1));
    expect(rms(r.left, 0.02, 1.18)).toBeLessThan(0.001);          // storing: quiet
    expect(rms(r.left, 2.45, 3.58)).toBeLessThan(0.001);          // asking again: silence
    [60, 64, 68, 72].forEach((n, i) => expect(pitch(r.left, 1.2 + 0.3 * i + 0.01, 1.2 + 0.3 * i + 0.2)).toBeCloseTo(mtof(n), -1));
    expect(peak(r.left, 1.2, 1.25)).toBeGreaterThan(0.1);          // a pluck
  });
});

describe('thresh/0: Gathering notes into a chord', () => {
  it('"trigger sends three pitches at once (a major triad); thresh gathers them ... The triad steps up a semitone each beat"', async () => {
    const r = await go('thresh', 0, { seconds: 3.7, listen: [{ box: 'thresh' }, { box: 'counter' }] });
    const t = r.heard.thresh, c = r.heard.counter;
    expect(t.length).toBe(c.length);
    t.forEach((x, i) => {
      const root = Number(c[i].msg[0]);
      expect([...x.msg].map(Number).sort((a, b) => a - b)).toEqual([root, root + 4, root + 7]);
      expect(x.t - c[i].t).toBeGreaterThanOrEqual(0.015);
      expect(x.t - c[i].t).toBeLessThan(0.04);
    });
    expect(nums(c).slice(0, 6)).toEqual(range(57, 62));
  });
});

// ═══ Delays ═══

describe('delay~/0: An echo, in samples', () => {
  it('"each pluck repeats 11025 samples (a quarter second) later"', async () => {
    const r = await go('delay~', 0, { seconds: 2.2 });
    expect(onset(r.left, 0)).toBeLessThan(0.01);
    expect(rms(r.left, 0.17, 0.245)).toBeLessThan(0.001);
    expect(onset(r.left, 0.17)).toBeCloseTo(0.25, 2);
    expect(peak(r.left, 0.25, 0.3)).toBeCloseTo(peak(r.left, 0, 0.05), 2);
    expect(onset(r.left, 1.17)).toBeCloseTo(1.25, 2);
  });
});

describe('tapin~/0: Echoes that fade', () => {
  it('"tapout~ reads it back 300 ms later. Feeding half the echo back in makes it repeat, quieter each time"', async () => {
    const r = await go('tapin~', 0, { seconds: 1.6 });
    const p0 = peak(r.left, 0, 0.12);
    expect(p0).toBeCloseTo(0.2, 2);
    expect(rms(r.left, 0.13, 0.295)).toBeLessThan(0.001);
    expect(onset(r.left, 0.13)).toBeCloseTo(0.3, 2);
    expect(onset(r.left, 0.43)).toBeCloseTo(0.6, 2);
    expect(onset(r.left, 0.73)).toBeCloseTo(0.9, 2);
    expect(peak(r.left, 0.3, 0.42) / p0).toBeCloseTo(0.5, 1);
    expect(peak(r.left, 0.6, 0.72) / p0).toBeCloseTo(0.25, 1);
    expect(peak(r.left, 0.9, 1.02) / p0).toBeCloseTo(0.125, 1);
  });
});

describe('tapout~/0: An echo on the right', () => {
  it('"you hear each note on the left, then its echo on the right" 375 ms later', async () => {
    const r = await go('tapout~', 0, { seconds: 1.6 });
    expect(onset(r.left, 0)).toBeLessThan(0.01);
    expect(peak(r.right, 0, 0.37)).toBeLessThan(0.001);
    expect(onset(r.right, 0)).toBeCloseTo(0.375, 2);
    expect(peak(r.right, 0.375, 0.45)).toBeCloseTo(peak(r.left, 0, 0.075), 2);
    expect(onset(r.left, 0.2)).toBeCloseTo(0.75, 2);
  });
  it('"drag the dial to set the echo from 0 to 1000 ms": dial 127 gives a 1000 ms echo', async () => {
    const r = await go('tapout~', 0, { seconds: 1.6, actions: [{ t: 0.005, box: 'dial', msg: [127] }] });
    expect(peak(r.right, 0, 0.99)).toBeLessThan(0.001);
    expect(onset(r.right, 0)).toBeCloseTo(1.0, 2);
  });
});

