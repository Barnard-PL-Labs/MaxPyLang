// Claims audit, group 3: lists (pack/unpack/zl.*), oscillators, routing, sampling, noise.
// Each test quotes the claim it checks. A test marked it.fails documents a real mismatch
// (engine, example text, or how maxpylang writes the box); the suite stays green.
import { describe, expect, it, vi } from 'vitest';
import '../../../web/src/objects';
import { Engine } from '../../../web/src/engine/engine';
import { parseMaxPat } from '../../../web/src/parser/maxpat';
import { preloadWorklets } from '../../../web/src/runtime/worklet';
import { loadBufferSource, loadSample } from '../../../web/src/objects/audio/samples';
import { example, SR, rms, peak, pitch, firsts, type Heard } from './helpers/measure';

type Atom = number | string;
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const STEP = 0.01;

// ── A runner like helpers/measure.run, plus: messages typed into boxes at given times
// (number box, toggle, message box), box names matched with the message box's leading
// space trimmed, and the drum clip handed back for comparison. ───────────────────────

interface Listen { box: string; outlet?: number; nth?: number; label?: string }
interface Inject { t: number; box: string; nth?: number; inlet?: number; msg: Atom[] }

const textOf = (b: any): string => String(b.box.text ?? b.box.maxclass).trim();
function ids(object: string, index: number, name: string): string[] {
  return example(object, index).patch.patcher.boxes
    .filter((b: any) => textOf(b) === name || textOf(b).split(' ')[0] === name)
    .map((b: any) => b.box.id);
}

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Out { left: Float32Array; heard: Record<string, Heard[]>; drums?: AudioBuffer; kick?: AudioBuffer; snare?: AudioBuffer }

async function render(object: string, index = 0, opts: { seconds?: number; listen?: Listen[]; at?: Inject[]; kit?: boolean } = {}): Promise<Out> {
  const ex = example(object, index);
  const seconds = opts.seconds ?? 2.5;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  const rand = vi.spyOn(Math, 'random').mockImplementation(seeded(1));
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const engine = new Engine(ctx);
  try {
    await preloadWorklets(ctx);
    engine.build(parseMaxPat(ex.patch));
    const nodes = (engine as any).nodes as Map<string, any>;
    let now = 0;
    const heard: Record<string, Heard[]> = {};
    for (const l of opts.listen ?? []) {
      const id = ids(object, index, l.box)[l.nth ?? 0];
      if (!id) throw new Error(`${object}/${index} has no box "${l.box}"`);
      const label = l.label ?? l.box;
      heard[label] = [];
      nodes.get(id)?.onControlOut?.(l.outlet ?? 0, (m: Atom[]) => heard[label].push({ t: now, msg: [...m] }));
    }
    const pending = [...(opts.at ?? [])].sort((a, b) => a.t - b.t);
    const names = ex.patch.patcher.boxes.map((b: any) => textOf(b).split(' ')[0]);
    const waitForSamples = names.includes('playlist~') || names.includes('buffer~');
    const drums = names.includes('buffer~') ? loadBufferSource(ctx, { kind: 'clip', id: 'drums' }) : undefined;
    const kick = opts.kit ? loadSample(ctx, { kind: 'kit', id: 'kick', guessed: true }) : undefined;
    const snare = opts.kit ? loadSample(ctx, { kind: 'kit', id: 'snare', guessed: true }) : undefined;
    await engine.start();
    for (let t = STEP; t < seconds; t += STEP) {
      const at = Math.round((t * SR) / 128) * 128 / SR;
      if (at >= seconds - 256 / SR) break;
      const first = t === STEP;
      void ctx.suspend(at).then(async () => {
        if (first && waitForSamples) await new Promise((r) => realSetTimeout(r, 1500));
        now = at;
        while (pending.length && pending[0].t <= at + 1e-9) {
          const p = pending.shift()!;
          const id = ids(object, index, p.box)[p.nth ?? 0];
          nodes.get(id)?.controlIns?.[p.inlet ?? 0]?.(p.msg);
        }
        vi.advanceTimersByTime(STEP * 1000);
        void ctx.resume();
      });
    }
    const buffer = await ctx.startRendering();
    return { left: buffer.getChannelData(0).slice(), heard, drums: await drums, kick: await kick, snare: await snare };
  } finally {
    await engine.stop();
    engine.clear();
    rand.mockRestore();
    vi.useRealTimers();
  }
}

// ── Measures ─────────────────────────────────────────────────────────────────────────
const seg = (x: Float32Array, t0: number, t1: number) => x.subarray(Math.round(t0 * SR), Math.round(t1 * SR));

/** Frequency from upward zero crossings (interpolated), precise for a clean periodic tone. */
function zcFreq(x: Float32Array, t0: number, t1: number): number {
  const s = seg(x, t0, t1);
  const ups: number[] = [];
  for (let i = 1; i < s.length; i++) if (s[i - 1] < 0 && s[i] >= 0) ups.push(i - 1 + s[i - 1] / (s[i - 1] - s[i]));
  return ups.length < 2 ? 0 : (SR * (ups.length - 1)) / (ups.at(-1)! - ups[0]);
}

/** Amplitude of the component at f Hz (Hann-windowed DFT bin), for a sine of amplitude a ≈ a. */
function amp(x: Float32Array, t0: number, t1: number, f: number): number {
  const s = seg(x, t0, t1);
  const n = s.length;
  let re = 0, im = 0, wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re += w * s[i] * Math.cos((2 * Math.PI * f * i) / SR);
    im -= w * s[i] * Math.sin((2 * Math.PI * f * i) / SR);
    wsum += w;
  }
  return (2 * Math.hypot(re, im)) / wsum;
}

/** Average power near f over many 4096-sample blocks (for noise spectra). */
function bandPower(x: Float32Array, t0: number, t1: number, f: number): number {
  const N = 4096;
  let p = 0, k = 0;
  for (let t = t0; t + N / SR <= t1; t += N / SR) {
    for (const df of [-0.04, -0.02, 0, 0.02, 0.04]) p += amp(x, t, t + N / SR, f * (1 + df)) ** 2;
    k++;
  }
  return p / Math.max(1, k);
}

/** Correlation coefficient of two equal-length arrays. */
function corr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return sab / Math.sqrt(saa * sbb || 1);
}

/** The buffer's channel 0, read at fractional sample positions (linear interpolation). */
function readAt(b: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  if (i < 0 || i + 1 >= b.length) return 0;
  return b[i] + (b[i + 1] - b[i]) * (pos - i);
}

/** Best match of x[t0..t1] against buffer channel 0 at speed 1: [lagSamples, correlation]. */
function findInBuffer(x: Float32Array, t0: number, t1: number, b: Float32Array, lo = 0, hi = b.length): [number, number] {
  const s = seg(x, t0, t1);
  let best = -2, at = 0;
  for (let p = lo; p + s.length < Math.min(hi + s.length, b.length); p += 1) {
    const c = corr(s, b.subarray(p, p + s.length));
    if (c > best) { best = c; at = p; }
  }
  return [at, best];
}

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const msgs = (h: Heard[]) => h.map((x) => x.msg);
const timesOf = (h: Heard[]) => h.map((x) => +x.t.toFixed(2));

// ═════════════════════════════════════════════════════════════════════════════════════
// Lists
// ═════════════════════════════════════════════════════════════════════════════════════

describe('append/0: Add a glide time to each note', () => {
  it('"Each note becomes \\"note 150\\", which tells line to slide to it in 150 ms instead of jumping"', async () => {
    const r = await render('append', 0, { seconds: 2.5, listen: [{ box: '+' }, { box: 'append' }, { box: 'line' }] });
    const notes = firsts(r.heard['+']) as number[];
    expect(notes.length).toBeGreaterThanOrEqual(8); // metro 300
    expect(msgs(r.heard.append)).toEqual(notes.map((n) => [n, 150]));
    // line slides: for each note well away from the last, the target is reached ~150 ms later
    // (Max: "just under the time specified (time minus grain)"), with values in between.
    let prev = 60, checked = 0;
    for (const h of r.heard['+']) {
      const n = h.msg[0] as number;
      if (Math.abs(n - prev) >= 3 && h.t < 2.1) {
        const after = r.heard.line.filter((l) => l.t >= h.t - 1e-6 && l.t < h.t + 0.29);
        const reach = after.find((l) => Math.abs((l.msg[0] as number) - n) < 1e-6)!;
        expect(reach.t - h.t).toBeGreaterThanOrEqual(0.1);
        expect(reach.t - h.t).toBeLessThanOrEqual(0.17);
        expect(after.some((l) => (l.msg[0] as number) !== n && (l.msg[0] as number) !== prev)).toBe(true);
        checked++;
      }
      prev = n;
    }
    expect(checked).toBeGreaterThan(2);
  });
  it.fails('BUG (engine): "line 60" has an int argument, so in Max it outputs ints (floatoutput off); the engine outputs floats (60.75, 61.5 ...)', async () => {
    const r = await render('append', 0, { seconds: 2.5, listen: [{ box: 'line' }] });
    for (const v of firsts(r.heard.line)) expect(Number.isInteger(v)).toBe(true);
  });
});

describe('funnel/0: Which clock was that?', () => {
  it('"the inlet number picks C for the left clock and G for the right" (a bang in inlet 1 -> "1 0")', async () => {
    const r = await render('funnel', 0, { seconds: 2.05, listen: [{ box: 'funnel' }, { box: '+' }] });
    const tagged = msgs(r.heard.funnel);
    for (const m of tagged) expect([[0, 0], [1, 0]]).toContainEqual(m);
    const left = r.heard.funnel.filter((h) => h.msg[0] === 0), right = r.heard.funnel.filter((h) => h.msg[0] === 1);
    expect(timesOf(left)).toEqual([0, 0.5, 1, 1.5, 2]);          // metro 500 into inlet 0
    expect(timesOf(right)).toEqual([0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8]); // metro 300 into inlet 1
    expect(firsts(r.heard['+'])).toEqual(tagged.map((m) => (m[0] === 0 ? 60 : 67)));
    expect(zcFreq(r.left, 0.32, 0.48)).toBeCloseTo(mtof(67), 0);  // right clock's last: G
    expect(zcFreq(r.left, 0.51, 0.59)).toBeCloseTo(mtof(60), 0);  // left clock's last: C
  });
});

describe('iter/0: A chord as an arpeggio', () => {
  it('"pipe holds each note ... 40 ms per semitone above 60, so the chord plays as a rising arpeggio"', async () => {
    const r = await render('iter', 0, { seconds: 1.2, listen: [{ box: 'iter' }, { box: 'pipe' }] });
    expect(firsts(r.heard.iter).slice(0, 4)).toEqual([60, 64, 67, 72]);
    const bar = r.heard.pipe.filter((h) => h.t < 0.9);
    expect(firsts(bar)).toEqual([60, 64, 67, 72]);
    [0, 0.16, 0.28, 0.48].forEach((d, i) => expect(Math.abs(bar[i].t - d)).toBeLessThan(0.015));
    expect(zcFreq(r.left, 0.3, 0.47)).toBeCloseTo(mtof(67), 0);
  });
  it('"change the number box to spread the notes out" (80 ms per semitone)', async () => {
    const r = await render('iter', 0, { seconds: 3.1, listen: [{ box: 'pipe' }], at: [{ t: 1.5, box: 'number', msg: [80] }] });
    const bar = r.heard.pipe.filter((h) => h.t >= 1.95 && h.t < 2.99);
    expect(firsts(bar)).toEqual([60, 64, 67, 72]);
    [2, 2.32, 2.56, 2.96].forEach((d, i) => expect(Math.abs(bar[i].t - d)).toBeLessThan(0.015));
  });
});

describe('join/0: An envelope in two halves', () => {
  it('"\\"1 5\\" and \\"0 300\\" join into the envelope \\"1 5 0 300\\" for line~, which strikes the tone on every beat"', async () => {
    const r = await render('join', 0, { seconds: 1.3, listen: [{ box: 'join' }] });
    expect(msgs(r.heard.join).at(-1)).toEqual([1, 5, 0, 300]);
    for (const t of [0, 0.4, 0.8]) {
      expect(peak(r.left, t + 0.004, t + 0.012)).toBeCloseTo(0.2, 1);      // up in 5 ms
      expect(peak(r.left, t + 0.15, t + 0.16)).toBeCloseTo(0.1, 1);       // half way down at 155 ms
      expect(peak(r.left, t + 0.31, t + 0.39)).toBeLessThan(0.005);       // silent after 305 ms
    }
    expect(zcFreq(r.left, 0.01, 0.2)).toBeCloseTo(330, 0);
  });
  it.fails('BUG (engine): join\'s right inlet is hot in the engine (Max: only the left inlet triggers, @triggers default) — each beat sends two lists, the first being "0 300" alone', async () => {
    const r = await render('join', 0, { seconds: 1.3, listen: [{ box: 'join' }] });
    expect(msgs(r.heard.join)).toEqual([[1, 5, 0, 300], [1, 5, 0, 300], [1, 5, 0, 300], [1, 5, 0, 300]]);
  });
});

describe('listfunnel/0: Load a melody into a table', () => {
  it('"listfunnel turns a list into numbered pairs: \\"0 60\\", \\"1 63\\", \\"2 67\\" ... which the counter then reads back in order"', async () => {
    const r = await render('listfunnel', 0, { seconds: 2.3, listen: [{ box: 'listfunnel' }, { box: 'table' }] });
    const tune = [60, 63, 67, 70, 72, 70, 67, 63];
    expect(msgs(r.heard.listfunnel)).toEqual(tune.map((n, i) => [i, n]));
    expect(firsts(r.heard.table).slice(0, 9)).toEqual([...tune, 60]);
    expect(timesOf(r.heard.table).slice(0, 3)).toEqual([0, 0.25, 0.5]);
  });
});

describe('pack/0: Glide from note to note', () => {
  it('"pack 0 200 combines the note ... with the glide time ... \\"note 200\\", which line slides through in 200 ms"', async () => {
    const r = await render('pack', 0, { seconds: 2.5, listen: [{ box: '+' }, { box: 'pack' }, { box: 'line' }] });
    expect(msgs(r.heard.pack)).toEqual(firsts(r.heard['+']).map((n) => [n, 200]));
    let prev = 60, checked = 0;
    for (const h of r.heard.pack) {
      const n = h.msg[0] as number;
      if (Math.abs(n - prev) >= 3 && h.t < 2.1) {
        const reach = r.heard.line.find((l) => l.t >= h.t - 1e-6 && Math.abs((l.msg[0] as number) - n) < 1e-6)!;
        expect(reach.t - h.t).toBeGreaterThanOrEqual(0.15);
        expect(reach.t - h.t).toBeLessThanOrEqual(0.22);
        checked++;
      }
      prev = n;
    }
    expect(checked).toBeGreaterThan(1);
  });
  it('"change the number box to set a new glide time" (cold: it waits for a note)', async () => {
    const r = await render('pack', 0, { seconds: 2.5, listen: [{ box: 'pack' }], at: [{ t: 1.0, box: 'number', msg: [50] }] });
    expect(r.heard.pack.filter((h) => Math.abs(h.t - 1.0) < 0.005)).toEqual([]); // cold inlet: no output
    for (const h of r.heard.pack) expect(h.msg[1]).toBe(h.t < 1.0 ? 200 : 50);
  });
});

describe('pak/0: Every inlet plays', () => {
  it('"a number at any inlet sends the whole list ... each change from either side plays"', async () => {
    const r = await render('pak', 0, { seconds: 2.45, listen: [{ box: 'pak' }, { box: 'zl.sum' }, { box: '+' }] });
    // fast clock: 0 .25 ... 2.25 (10 ticks), slow: 0 1 2 (3 ticks) -> 13 lists
    expect(r.heard.pak.length).toBe(13);
    for (const m of msgs(r.heard.pak)) {
      expect([0, 5, 10]).toContain(m[0]);
      expect([0, 4, 8, 12]).toContain(m[1]);
    }
    expect(firsts(r.heard['+'])).toEqual(msgs(r.heard.pak).map((m) => (m[0] as number) + (m[1] as number) + 55));
    // the last list in each beat: root from the slow clock, chord step from the fast one
    const lastAt = (t: number) => r.heard.pak.filter((h) => h.t <= t + 0.005).at(-1)!.msg;
    expect(lastAt(0.5)).toEqual([0, 8]);
    expect(lastAt(1.0)).toEqual([5, 0]);
    expect(lastAt(1.75)).toEqual([5, 12]);
    expect(lastAt(2.0)).toEqual([10, 0]);
  });
});

describe('prepend/0: Build an envelope from a number', () => {
  it('"The counter\'s 60 to 420 becomes \\"1 5 0 60\\" ... \\"1 5 0 420\\" ... each strike rings a little longer"', async () => {
    const r = await render('prepend', 0, { seconds: 3.2, listen: [{ box: 'prepend' }] });
    expect(msgs(r.heard.prepend).slice(0, 7)).toEqual([1, 2, 3, 4, 5, 6, 7].map((k) => [1, 5, 0, 60 * k]));
    for (let k = 1; k <= 7; k++) {
      const t = 0.45 * (k - 1), d = (60 * k) / 1000;
      expect(peak(r.left, t + 0.004, t + 0.009)).toBeGreaterThan(0.18);
      expect(peak(r.left, t + 0.005 + d / 2 - 0.003, t + 0.005 + d / 2 + 0.003)).toBeCloseTo(0.1, 1); // half way down
      expect(peak(r.left, t + 0.005 + d + 0.005, t + 0.445)).toBeLessThan(0.005);              // over
    }
  });
});

describe('spray/0: Send each note to a voice', () => {
  it('"\\"0 64\\" goes out of the left outlet, \\"1 69\\" out of the right. Notes go to the two voices in turn"', async () => {
    const r = await render('spray', 0, {
      seconds: 2.5,
      listen: [{ box: 'pack' }, { box: 'spray', outlet: 0, label: 'a' }, { box: 'spray', outlet: 1, label: 'b' }],
    });
    const lists = msgs(r.heard.pack);
    expect(lists.map((m) => m[0])).toEqual(lists.map((_, i) => i % 2));
    expect(firsts(r.heard.a)).toEqual(lists.filter((m) => m[0] === 0).map((m) => m[1]));
    expect(firsts(r.heard.b)).toEqual(lists.filter((m) => m[0] === 1).map((m) => m[1]));
    expect(timesOf(r.heard.a)).toEqual(timesOf(r.heard.pack).filter((_, i) => i % 2 === 0));
  });
});

describe('unpack/0: One list, three notes', () => {
  it('"The list \\"60 64 67\\" becomes three numbers ... which sound together as a C major chord"', async () => {
    const r = await render('unpack', 0, {
      seconds: 1,
      listen: [0, 1, 2].map((o) => ({ box: 'unpack', outlet: o, label: `u${o}` })),
    });
    expect([r.heard.u0, r.heard.u1, r.heard.u2].map(firsts)).toEqual([[60], [64], [67]]);
    for (const m of [60, 64, 67]) expect(amp(r.left, 0.2, 0.9, mtof(m))).toBeCloseTo(0.2, 1);
    expect(amp(r.left, 0.2, 0.9, 440)).toBeLessThan(0.01);
  });
});

describe('zl.change/0: Strike only new notes', () => {
  it('"repeats are dropped, so they never strike a new note"', async () => {
    const r = await render('zl.change', 0, { seconds: 4, listen: [{ box: 'random' }, { box: 'zl.change' }, { box: '1 5 0 300', label: 'strike' }] });
    const picks = firsts(r.heard.random);
    const changes = picks.filter((v, i) => i === 0 || v !== picks[i - 1]);
    expect(firsts(r.heard['zl.change'])).toEqual(changes);
    expect(r.heard.strike.length).toBe(changes.length);
    expect(changes.length).toBeLessThan(picks.length);
  });
  it('"set the number box to 6: with more notes to pick from, repeats are rarer and more beats strike"', async () => {
    const r = await render('zl.change', 0, { seconds: 12, listen: [{ box: 'random' }, { box: 'zl.change' }], at: [{ t: 6, box: 'number', msg: [6] }] });
    const before = r.heard.random.filter((h) => h.t < 6), after = r.heard.random.filter((h) => h.t >= 6);
    expect(Math.max(...(firsts(after) as number[]))).toBeGreaterThan(2);
    const rate = (from: number, to: number) => r.heard['zl.change'].filter((h) => h.t >= from && h.t < to).length / r.heard.random.filter((h) => h.t >= from && h.t < to).length;
    expect(before.length).toBeGreaterThan(30);
    expect(rate(6.2, 12)).toBeGreaterThan(rate(0, 6));
  });
});

describe('zl.compare/0: Hear when two lists match', () => {
  it('"each time a pair is \\"0 1\\" the note jumps up a fifth"', async () => {
    const r = await render('zl.compare', 0, { seconds: 2.0, listen: [{ box: 'zl.group' }, { box: 'zl.compare' }, { box: '+' }] });
    const pairs = msgs(r.heard['zl.group']);
    expect(pairs.slice(0, 4)).toEqual([[0, 1], [2, 0], [1, 2], [0, 1]]);
    expect(firsts(r.heard['zl.compare'])).toEqual(pairs.map((p) => (p[0] === 0 && p[1] === 1 ? 1 : 0)));
    expect(firsts(r.heard['+'])).toEqual(pairs.map((p) => (p[0] === 0 && p[1] === 1 ? 67 : 60)));
  });
});

describe('zl.delace/0: Unzip a list into tune and bass', () => {
  it('"1st, 3rd, 5th ... out of its left outlet and the 2nd, 4th, 6th ... out of its right ... plays as two voices"', async () => {
    const r = await render('zl.delace', 0, {
      seconds: 2.5,
      listen: [{ box: 'zl.delace', outlet: 0, label: 'L' }, { box: 'zl.delace', outlet: 1, label: 'R' }, { box: 'zl.nth', nth: 0, label: 'tune' }, { box: 'zl.nth', nth: 1, label: 'bass' }],
    });
    expect(r.heard.L[0].msg).toEqual([67, 69, 71, 72]);
    expect(r.heard.R[0].msg).toEqual([48, 53, 55, 48]);
    expect(firsts(r.heard.tune).slice(0, 8)).toEqual([67, 69, 71, 72, 67, 69, 71, 72]);
    expect(firsts(r.heard.bass).slice(0, 8)).toEqual([48, 53, 55, 48, 48, 53, 55, 48]);
    expect(amp(r.left, 0.35, 0.58, mtof(69))).toBeCloseTo(0.2, 1);
    expect(amp(r.left, 0.35, 0.58, mtof(53))).toBeCloseTo(0.2, 1);
  });
});

describe('zl.filter/0: Leave out the black keys', () => {
  it('"Taking 61 63 66 68 70 out of all 13 notes from 60 to 72 leaves the C major scale"', async () => {
    const r = await render('zl.filter', 0, { seconds: 2.1, listen: [{ box: 'zl.filter' }, { box: 'zl.nth' }] });
    const scale = [60, 62, 64, 65, 67, 69, 71, 72];
    expect(r.heard['zl.filter'][0].msg).toEqual(scale);
    expect(firsts(r.heard['zl.nth']).slice(0, 8)).toEqual(scale);
  });
});

describe('zl.group/0: Collect notes into pairs', () => {
  it('"zl.group 2 waits for two numbers, then sends them out together ... random notes arrive as two-note chords"', async () => {
    const r = await render('zl.group', 0, {
      seconds: 2.1,
      listen: [{ box: '+' }, { box: 'zl.group' }, { box: 'unpack', outlet: 0, label: 'a' }, { box: 'unpack', outlet: 1, label: 'b' }],
    });
    const notes = firsts(r.heard['+']);
    const pairs = msgs(r.heard['zl.group']);
    expect(pairs.length).toBe(Math.floor(notes.length / 2));
    expect(pairs).toEqual(pairs.map((_, i) => [notes[2 * i], notes[2 * i + 1]]));
    expect(timesOf(r.heard['zl.group'])).toEqual(timesOf(r.heard['+']).filter((_, i) => i % 2 === 1));
    expect(firsts(r.heard.a)).toEqual(pairs.map((p) => p[0]));
    expect(firsts(r.heard.b)).toEqual(pairs.map((p) => p[1]));
  });
});

describe('zl.join/0: Two phrases make one tune', () => {
  it('"A rising phrase and a falling phrase join into one 8-note tune"', async () => {
    const r = await render('zl.join', 0, { seconds: 2.1, listen: [{ box: 'zl.join' }, { box: 'zl.nth' }] });
    const tune = [60, 64, 67, 72, 71, 67, 65, 62];
    expect(r.heard['zl.join'][0].msg).toEqual(tune);
    expect(firsts(r.heard['zl.nth']).slice(0, 8)).toEqual(tune);
  });
});

describe('zl.len/0: Loop as long as the list', () => {
  it('"Sent to counter as \\"max 5\\", the count makes the loop exactly as long as the melody"', async () => {
    const r = await render('zl.len', 0, { seconds: 3.1, listen: [{ box: 'zl.len' }, { box: 'prepend' }, { box: 'zl.nth' }, { box: 'counter' }] });
    expect(firsts(r.heard['zl.len'])[0]).toBe(5);
    expect(r.heard.prepend[0].msg).toEqual(['max', 5]);
    expect(firsts(r.heard.counter).slice(0, 11)).toEqual([1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1]);
    expect(firsts(r.heard['zl.nth']).slice(0, 11)).toEqual([60, 63, 67, 70, 72, 60, 63, 67, 70, 72, 60]);
  });
  it('"editing the message box changes the loop too" (the box set to 60 62 64)', async () => {
    const r = await render('zl.len', 0, { seconds: 5, listen: [{ box: 'zl.nth' }], at: [{ t: 2.02, box: '60', msg: ['set', 60, 62, 64] }] });
    const late = firsts(r.heard['zl.nth'].filter((h) => h.t > 3));
    const start = late.indexOf(60);
    expect(late.slice(start, start + 6)).toEqual([60, 62, 64, 60, 62, 64]);
  });
});

describe('zl.median/0: Smooth out random notes', () => {
  it('"zl.group gathers random notes in threes and only the middle one of each three plays"', async () => {
    const r = await render('zl.median', 0, { seconds: 2.5, listen: [{ box: 'random' }, { box: 'zl.group' }, { box: 'zl.median' }, { box: '+' }] });
    const picks = firsts(r.heard.random) as number[];
    const groups = msgs(r.heard['zl.group']) as number[][];
    expect(groups.length).toBe(Math.floor(picks.length / 3));
    groups.forEach((g, i) => expect(g).toEqual(picks.slice(3 * i, 3 * i + 3)));
    const med = (g: number[]) => [...g].sort((a, b) => a - b)[1];
    expect(firsts(r.heard['zl.median'])).toEqual(groups.map(med));
    expect(firsts(r.heard['+'])).toEqual(groups.map((g) => med(g) + 55));
  });
  it('"set the number box to 7 to take the middle of seven"', async () => {
    const r = await render('zl.median', 0, { seconds: 4, listen: [{ box: 'zl.group' }, { box: 'zl.median' }], at: [{ t: 1.0, box: 'number', msg: [7] }] });
    const late = r.heard['zl.group'].filter((h) => h.t > 2);
    expect(late.length).toBeGreaterThan(1);
    for (const h of late) expect(h.msg.length).toBe(7);
    const lateMed = r.heard['zl.median'].filter((h) => h.t > 2);
    lateMed.forEach((h, i) => expect(h.msg[0]).toBe([...(late[i].msg as number[])].sort((a, b) => a - b)[3]));
  });
});

describe('zl.nth/0: Play a melody stored as a list', () => {
  it('"zl.nth sends out the item at a position in a list, counting from 1 ... the message box plays as a tune"', async () => {
    const r = await render('zl.nth', 0, { seconds: 2.1, listen: [{ box: 'zl.nth' }] });
    expect(firsts(r.heard['zl.nth']).slice(0, 8)).toEqual([60, 62, 64, 67, 69, 67, 64, 62]);
    expect(timesOf(r.heard['zl.nth']).slice(0, 3)).toEqual([0, 0.25, 0.5]);
  });
});

describe('zl.queue/0: First in, first out', () => {
  it('"the chord is queued, then one note leaves per beat, in the order they went in"', async () => {
    const r = await render('zl.queue', 0, { seconds: 2.1, listen: [{ box: 'zl.queue' }] });
    expect(firsts(r.heard['zl.queue']).slice(0, 8)).toEqual([60, 64, 67, 72, 60, 64, 67, 72]);
  });
});

describe('zl.rev/0: A melody and its mirror', () => {
  it('"One voice plays the scale as written while a second plays the zl.rev copy"', async () => {
    const r = await render('zl.rev', 0, { seconds: 2.1, listen: [{ box: 'zl.nth', nth: 0, label: 'up' }, { box: 'zl.nth', nth: 1, label: 'down' }] });
    expect(firsts(r.heard.up).slice(0, 8)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(firsts(r.heard.down).slice(0, 8)).toEqual([72, 71, 69, 67, 65, 64, 62, 60]);
  });
});

describe('zl.rot/0: A round from one list', () => {
  it('"The second voice plays the tune rotated 2 places, so it follows the first 2 notes behind"', async () => {
    const r = await render('zl.rot', 0, { seconds: 4.1, listen: [{ box: 'zl.rot' }, { box: 'zl.nth', nth: 0, label: 'lead' }, { box: 'zl.nth', nth: 1, label: 'follow' }] });
    expect(r.heard['zl.rot'][0].msg).toEqual([64, 62, 60, 62, 64, 65, 67, 65]); // positive = right (Max)
    const lead = firsts(r.heard.lead) as number[], follow = firsts(r.heard.follow) as number[];
    for (let k = 2; k < 16; k++) expect(follow[k]).toBe(lead[k - 2]);
  });
  it('"change the number box to set how far behind" (1)', async () => {
    const r = await render('zl.rot', 0, { seconds: 4.1, listen: [{ box: 'zl.nth', nth: 0, label: 'lead' }, { box: 'zl.nth', nth: 1, label: 'follow' }], at: [{ t: 1.02, box: 'number', msg: [1] }] });
    const lead = firsts(r.heard.lead) as number[], follow = firsts(r.heard.follow) as number[];
    for (let k = 6; k < 16; k++) expect(follow[k]).toBe(lead[k - 1]);
  });
});

describe('zl.slice/0: Split a list into two voices', () => {
  it('"zl.slice 4 sends the first 4 items out of its left outlet and the rest out of its right"', async () => {
    const r = await render('zl.slice', 0, {
      seconds: 2.5,
      listen: [{ box: 'zl.slice', outlet: 0, label: 'L' }, { box: 'zl.slice', outlet: 1, label: 'R' }, { box: 'zl.nth', nth: 0, label: 'low' }, { box: 'zl.nth', nth: 1, label: 'high' }],
    });
    expect(r.heard.L[0].msg).toEqual([48, 53, 55, 52]);
    expect(r.heard.R[0].msg).toEqual([64, 65, 67, 64]);
    expect(firsts(r.heard.low).slice(0, 4)).toEqual([48, 53, 55, 52]);
    expect(firsts(r.heard.high).slice(0, 4)).toEqual([64, 65, 67, 64]);
  });
});

describe('zl.sort/0: Put the notes in order', () => {
  it('"after zl.sort it plays as a rising scale"', async () => {
    const r = await render('zl.sort', 0, { seconds: 2.1, listen: [{ box: 'zl.sort' }, { box: 'zl.nth' }] });
    expect(r.heard['zl.sort'][0].msg).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(firsts(r.heard['zl.nth']).slice(0, 8)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });
  it('"set the number box to -1 to sort it falling instead"', async () => {
    const r = await render('zl.sort', 0, { seconds: 4.1, listen: [{ box: 'zl.nth' }], at: [{ t: 1.9, box: 'number', msg: [-1] }] });
    expect(firsts(r.heard['zl.nth'].filter((h) => h.t > 1.95)).slice(0, 8)).toEqual([72, 71, 69, 67, 65, 64, 62, 60]);
  });
});

describe('zl.stack/0: Last in, first out', () => {
  it('"The chord goes in from the bottom up, so it comes back out from the top down"', async () => {
    const r = await render('zl.stack', 0, { seconds: 2.1, listen: [{ box: 'zl.stack' }] });
    expect(firsts(r.heard['zl.stack']).slice(0, 8)).toEqual([72, 67, 64, 60, 72, 67, 64, 60]);
  });
});

describe('zl.sum/0: A scale from its steps', () => {
  it('"zl.slice keeps the first 1 to 8 of them, and their sum above 60 climbs the C major scale"', async () => {
    const r = await render('zl.sum', 0, { seconds: 2.1, listen: [{ box: 'zl.slice' }, { box: 'zl.sum' }, { box: '+' }] });
    expect(msgs(r.heard['zl.slice']).slice(0, 3)).toEqual([[0], [0, 2], [0, 2, 2]]);
    expect(firsts(r.heard['zl.sum']).slice(0, 8)).toEqual([0, 2, 4, 5, 7, 9, 11, 12]);
    expect(firsts(r.heard['+']).slice(0, 8)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(zcFreq(r.left, 1.02, 1.23)).toBeCloseTo(mtof(67), 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// Oscillators
// ═════════════════════════════════════════════════════════════════════════════════════

describe('cycle~/0: A 440 Hz sine tone', () => {
  it('"cycle~ is a sine-wave oscillator. Its argument is the frequency in hertz"', async () => {
    const r = await render('cycle~', 0, { seconds: 0.6 });
    expect(zcFreq(r.left, 0.1, 0.5)).toBeCloseTo(440, 1);
    expect(rms(r.left, 0.1, 0.5)).toBeCloseTo(0.2 / Math.SQRT2, 3);
    expect(amp(r.left, 0.1, 0.5, 880)).toBeLessThan(0.001); // pure
  });
  it.fails('BUG (engine): cycle~ is a cosine in Max (starts at 1); the engine uses a sine OscillatorNode (starts at 0)', async () => {
    const r = await render('cycle~', 0, { seconds: 0.1 });
    expect(r.left[0]).toBeCloseTo(0.2, 2);
  });
});

describe('cycle~/1: Vibrato: one sine bends another', () => {
  it('"A slow cycle~ (5 Hz) is scaled to ±8 Hz and added to 330 Hz"', async () => {
    const r = await render('cycle~', 1, { seconds: 1.2 });
    const track: number[] = [];
    for (let t = 0.1; t < 1.1; t += 0.01) track.push(zcFreq(r.left, t, t + 0.02));
    expect(Math.max(...track)).toBeGreaterThan(336);
    expect(Math.max(...track)).toBeLessThan(339.5);
    expect(Math.min(...track)).toBeLessThan(324);
    expect(Math.min(...track)).toBeGreaterThan(320.5);
    // 5 times a second: the highest points are 0.2 s apart
    const peaks = track.map((f, i) => (i > 0 && i < track.length - 1 && f >= track[i - 1] && f > track[i + 1] && f > 335 ? 0.1 + i * 0.01 : -1)).filter((t) => t > 0);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i] - peaks[i - 1]).toBeCloseTo(0.2, 1);
    expect(zcFreq(r.left, 0.1, 1.1)).toBeCloseTo(330, 0);
  });
});

describe('phasor~/0: A ramp from 0 to 1', () => {
  it('"phasor~ ramps from 0 to 1 and jumps back, 220 times a second. Scaling it to -1..1 makes it audible as a sawtooth"', async () => {
    const r = await render('phasor~', 0, { seconds: 1.1 });
    const s = seg(r.left, 0.05, 1.05);
    let drops = 0, ups = 0;
    for (let i = 1; i < s.length; i++) { const d = s[i] - s[i - 1]; if (d < -0.2) drops++; else if (Math.abs(d - (0.4 * 220) / SR) < 1e-4) ups++; }
    expect(drops).toBeGreaterThanOrEqual(219);
    expect(drops).toBeLessThanOrEqual(221);
    expect(ups / s.length).toBeGreaterThan(0.98); // a straight rising ramp in between
    expect(Math.max(...s)).toBeCloseTo(0.2, 2);
    expect(Math.min(...s)).toBeCloseTo(-0.2, 2);
  });
});

describe('phasor~/1: A rising sweep', () => {
  it('"sweeps a cycle~ from 200 to 1000 Hz every two seconds"', async () => {
    const r = await render('phasor~', 1, { seconds: 2.5 });
    expect(zcFreq(r.left, 0.09, 0.11)).toBeCloseTo(240, -1);
    expect(zcFreq(r.left, 0.99, 1.01)).toBeCloseTo(600, -1);
    expect(zcFreq(r.left, 1.89, 1.91)).toBeCloseTo(960, -1);
    expect(zcFreq(r.left, 2.09, 2.11)).toBeCloseTo(240, -1); // back down, and again
  });
});

/** Fraction of a steady wave's samples above the midpoint between its extremes. */
function duty(x: Float32Array, t0: number, t1: number): number {
  const s = seg(x, t0, t1);
  let hi = -Infinity, lo = Infinity;
  for (const v of s) { hi = Math.max(hi, v); lo = Math.min(lo, v); }
  let n = 0;
  for (const v of s) if (v > (hi + lo) / 2) n++;
  return n / s.length;
}

describe('rect~/0: A square wave', () => {
  it('"hollow, clarinet-like tone (odd harmonics only) ... 0.5 is a square"', async () => {
    const r = await render('rect~', 0, { seconds: 1 });
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(165, 0);
    expect(duty(r.left, 0.1, 0.9)).toBeCloseTo(0.5, 1);
    const h1 = amp(r.left, 0.1, 0.9, 165);
    expect(amp(r.left, 0.1, 0.9, 330) / h1).toBeLessThan(0.02);
    expect(amp(r.left, 0.1, 0.9, 495) / h1).toBeCloseTo(1 / 3, 1);
  });
});

describe('rect~/1: A thin pulse', () => {
  it.fails('BUG (engine): "A narrow pulse width (0.1)" — the engine ignores rect~\'s pulse width and plays a square', async () => {
    const r = await render('rect~', 1, { seconds: 1 });
    expect(duty(r.left, 0.1, 0.9)).toBeCloseTo(0.1, 1);
    // a 10% pulse has a strong 2nd harmonic (sin(0.2π)/2 ÷ sin(0.1π) ≈ 0.95)
    expect(amp(r.left, 0.1, 0.9, 330) / amp(r.left, 0.1, 0.9, 165)).toBeGreaterThan(0.5);
  });
  it('pitch is 165 Hz', async () => {
    const r = await render('rect~', 1, { seconds: 1 });
    expect(pitch(r.left, 0.1, 0.4)).toBeCloseTo(165, -1);
  });
});

describe('saw~/0: A sawtooth wave', () => {
  it('"a bright, buzzy tone with every harmonic. Here it plays 110 Hz"', async () => {
    const r = await render('saw~', 0, { seconds: 1 });
    expect(pitch(r.left, 0.1, 0.5)).toBeCloseTo(110, -1);
    const h1 = amp(r.left, 0.1, 0.9, 110);
    for (const n of [2, 3, 4, 5]) expect(amp(r.left, 0.1, 0.9, 110 * n) / h1).toBeCloseTo(1 / n, 1);
  });
});

describe('train~/0: A click track', () => {
  it.fails('BUG (engine): "1 for part of each period and 0 for the rest ... 2% on" — engine plays a ±1 square at 50% duty', async () => {
    const r = await render('train~', 0, { seconds: 1.1 });
    const s = seg(r.left, 0, 1.0);
    expect(Math.min(...s)).toBeGreaterThan(-0.001);              // never below 0
    let on = 0;
    for (const v of s) if (v > 0.1) on++;
    expect(on / s.length).toBeCloseTo(0.02, 2);                   // 5 ms of each 250 ms
  });
  it('"A 250 ms period gives four clicks a second"', async () => {
    const r = await render('train~', 0, { seconds: 1.1 });
    const s = seg(r.left, 0, 0.99);
    const onsets: number[] = [];
    for (let i = 0; i < s.length; i++) if (s[i] > 0.1 && (i === 0 || s[i - 1] <= 0.1)) onsets.push(i / SR);
    expect(onsets.length).toBe(4);
    for (let i = 1; i < onsets.length; i++) expect(onsets[i] - onsets[i - 1]).toBeCloseTo(0.25, 2);
  });
});

describe('tri~/0: A triangle wave', () => {
  it('"soft, with faint odd harmonics"', async () => {
    const r = await render('tri~', 0, { seconds: 1 });
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(220, 0);
    const h1 = amp(r.left, 0.1, 0.9, 220);
    expect(amp(r.left, 0.1, 0.9, 440) / h1).toBeLessThan(0.02);
    expect(amp(r.left, 0.1, 0.9, 660) / h1).toBeCloseTo(1 / 9, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// Wavetables and sampling (the CC0 drum loop stands in for drumLoop.aif)
// ═════════════════════════════════════════════════════════════════════════════════════

/** One period (of `n` samples) of the output starting at t, resampled to `m` points. */
function period(x: Float32Array, t: number, n: number, m: number): number[] {
  const i0 = Math.round(t * SR);
  return Array.from({ length: m }, (_, k) => readAt(x, i0 + (k * n) / m));
}

describe('wave~/0: A wavetable from a recording', () => {
  it('"the stretch is 10 ms of the drum loop, from 100 to 110 ms, and phasor~ sweeps through it 110 times a second"', async () => {
    const r = await render('wave~', 0, { seconds: 1.5 });
    const b = r.drums!.getChannelData(0);
    expect(pitch(r.left, 0.5, 1.0)).toBeCloseTo(110, -1);
    // one period of the output is buffer samples 100..110 ms (scaled by *~ 0.3)
    const tbl = Array.from({ length: 200 }, (_, k) => readAt(b, 0.1 * SR + (k * 0.01 * SR) / 200));
    const n = SR / 110;
    let best = -1;
    for (let off = 0; off < n; off += 1) best = Math.max(best, corr(period(r.left, 0.6 + off / SR, n, 200), tbl));
    expect(best).toBeGreaterThan(0.95);
    expect(rms(r.left, 0.5, 1.0)).toBeGreaterThan(0.005);
  });
});

describe('2d.wave~/0: A tone that morphs between slices of a recording', () => {
  it('"80 ms of the drum loop becomes 8 rows of 10 ms, X sweeps a row 110 times a second ... a 110 Hz tone morphs"', async () => {
    const r = await render('2d.wave~', 0, { seconds: 5.2 });
    const b = r.drums!.getChannelData(0);
    const n = SR / 110;
    for (const t of [0.5, 1.5, 2.5, 3.5]) expect(pitch(r.left, t, t + 0.2)).toBeCloseTo(110, -1);
    // Which row plays: compare one period with each 10 ms row of the buffer.
    const rowMatch = (t: number) => {
      const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((row) => {
        const tbl = Array.from({ length: 200 }, (_, k) => readAt(b, (row * 0.01 + (k * 0.01) / 200) * SR));
        let best = -1;
        for (let off = 0; off < n; off += 2) best = Math.max(best, corr(period(r.left, t + off / SR, n, 200), tbl));
        return best;
      });
      return scores.indexOf(Math.max(...scores));
    };
    // Y = 0.5 + 0.5·(slow sine at 0.2 Hz): the row moves over 0..7 and back in 5 s.
    const rows = [0.05, 1.25, 2.5, 3.75, 4.95].map(rowMatch);
    expect(Math.max(...rows) - Math.min(...rows)).toBeGreaterThanOrEqual(5);
  });
});

describe('buffer~/0: Loading a sound file', () => {
  it('"groove~ loops it at normal speed: a signal of 1 into its left inlet"', async () => {
    const r = await render('buffer~', 0, { seconds: 11 });
    const b = r.drums!.getChannelData(0);
    const len = r.drums!.length / SR;
    expect(rms(r.left, 0.1, 9)).toBeGreaterThan(0.01);
    // the output is the file from its start, at speed 1
    const [p0, c0] = findInBuffer(r.left, 0.5, 0.55, b, Math.round(0.4 * SR), Math.round(0.6 * SR));
    expect(c0).toBeGreaterThan(0.95);
    const start = 0.5 - p0 / SR; // when playback began
    expect(start).toBeGreaterThanOrEqual(0);
    expect(start).toBeLessThan(0.03);
    const [p1, c1] = findInBuffer(r.left, 5.0, 5.05, b, Math.round((5.0 - start - 0.01) * SR), Math.round((5.0 - start + 0.01) * SR));
    expect(c1).toBeGreaterThan(0.95);
    expect(Math.abs(p1 / SR - (5.0 - start))).toBeLessThan(0.002);
    // and it loops: after the end, the start again
    const t = start + len + 0.3;
    const [p2, c2] = findInBuffer(r.left, t, t + 0.05, b, Math.round(0.28 * SR), Math.round(0.32 * SR));
    expect(c2).toBeGreaterThan(0.95);
    expect(Math.abs(p2 / SR - 0.3)).toBeLessThan(0.002);
  });
});

describe('groove~/0: Speeding a loop up and down', () => {
  it('"A slow sine swings the speed between 0.5 and 1.5 every four seconds"', async () => {
    const r = await render('groove~', 0, { seconds: 4.3 });
    const b = r.drums!.getChannelData(0);
    // Model: position(t) = ∫ (1 + 0.5·lfo) dt from the moment playback began. Try the
    // lfo as cosine (Max's cycle~) and as sine, and a few start times; keep the best fit.
    let best = -1;
    for (const shape of [Math.cos, Math.sin]) {
      for (let start = 0; start <= 0.03; start += 0.0002) {
        const t0 = 0.2, t1 = 4.2;
        const pred: number[] = [], got: number[] = [];
        for (let i = Math.round(t0 * SR); i < t1 * SR; i += 7) {
          const t = i / SR;
          // ∫ from start to t of 1 + 0.5·shape(2π·0.25·u) du
          const w = 2 * Math.PI * 0.25;
          const integ = shape === Math.cos ? (t - start) + (0.5 / w) * (Math.sin(w * t) - Math.sin(w * start)) : (t - start) - (0.5 / w) * (Math.cos(w * t) - Math.cos(w * start));
          pred.push(readAt(b, integ * SR));
          got.push(r.left[i]);
        }
        best = Math.max(best, corr(pred, got));
      }
    }
    expect(best).toBeGreaterThan(0.8);
  });
});

describe('play~/0: Playing part of a file with line~', () => {
  it('"play~ plays the first 1.5 seconds of the loop, again and again" (every 1.6 s)', async () => {
    const r = await render('play~', 0, { seconds: 3.5 });
    const b = r.drums!.getChannelData(0);
    for (const t0 of [0, 1.6]) {
      // within each sweep the output is the file from 0 ms at speed 1
      for (const into of [0.2, 0.8, 1.4]) {
        const [p, c] = findInBuffer(r.left, t0 + into, t0 + into + 0.05, b, Math.round((into - 0.05) * SR), Math.round((into + 0.05) * SR));
        expect(c).toBeGreaterThan(0.95);
        expect(Math.abs(p / SR - into)).toBeLessThan(0.02);
      }
    }
  });
});

describe('record~/0: Grabbing a stutter from a loop', () => {
  it('"every 2.4 seconds metro starts a new take ... groove~ loops snip ... a new one with each take"', async () => {
    const r = await render('record~', 0, { seconds: 5.2 });
    expect(rms(r.left, 0.5, 2.3)).toBeGreaterThan(0.005);
    // a 400 ms loop: the output repeats itself 400 ms later
    const lag = Math.round(0.4 * SR);
    const a = seg(r.left, 0.9, 1.3), a2 = seg(r.left, 0.9 + 0.4, 1.3 + 0.4);
    expect(corr(a, a2)).toBeGreaterThan(0.95);
    void lag;
    // a new take after 2.4 s: what loops then is different
    const c = seg(r.left, 3.3, 3.7), c2 = seg(r.left, 3.7, 4.1);
    expect(corr(c, c2)).toBeGreaterThan(0.95);
    // and the take is the drum loop as it played at the moment of the take (0..400 ms)
    const b = r.drums!.getChannelData(0);
    const [, cm] = findInBuffer(r.left, 1.0, 1.1, b, 0, Math.round(0.5 * SR));
    expect(cm).toBeGreaterThan(0.9);
  });
  it.fails('BUG (example, on this page): "a new one with each take" — 2400 ms is exactly one bar of the 100 bpm stand-in loop, so every take grabs the same beat', async () => {
    const r = await render('record~', 0, { seconds: 5.2 });
    const a = seg(r.left, 0.9, 1.3);
    let maxSame = -1;
    for (let off = 0; off < 0.4 * SR; off += 32) maxSame = Math.max(maxSame, corr(a, seg(r.left, 3.3 + off / SR, 3.7 + off / SR)));
    expect(maxSame).toBeLessThan(0.8);
  });
});

describe('playlist~/0: A two-sound drum loop', () => {
  it('"counter alternates 1 and 2 every 250 ms, so the kick-and-hat and the snare take turns"', async () => {
    const r = await render('playlist~', 0, { seconds: 2.1, kit: true, listen: [{ box: 'counter' }] });
    expect(firsts(r.heard.counter).slice(0, 8)).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
    const kick = r.kick!.getChannelData(0), snare = r.snare!.getChannelData(0);
    const like = (t: number, ref: Float32Array) => {
      let best = -1;
      for (let off = -0.02; off <= 0.03; off += 0.0005) {
        const s = seg(r.left, t + off, t + off + 0.08);
        best = Math.max(best, Math.abs(corr(s, ref.subarray(0, s.length))));
      }
      return best;
    };
    // beats 1..7 (beat 0 may come before the files load)
    for (let k = 1; k < 8; k++) {
      const t = 0.25 * k, isKick = k % 2 === 0;
      const kk = like(t, kick), ss = like(t, snare);
      expect(isKick ? kk > ss : ss > kk).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// Routing
// ═════════════════════════════════════════════════════════════════════════════════════

describe('forward/0: Send to a name you can change', () => {
  it('"Notes go to \\"low\\" (two octaves down) until you click the toggle, which forwards them to \\"high\\""', async () => {
    const r = await render('forward', 0, {
      seconds: 3,
      listen: [{ box: 'random' }, { box: '+ 48', label: 'low' }, { box: '+ 72', label: 'high' }],
      at: [{ t: 1.05, box: 'toggle', msg: [1] }, { t: 2.05, box: 'toggle', msg: [0] }],
    });
    const picks = r.heard.random;
    const inRange = (h: Heard[], a: number, b: number) => h.filter((x) => x.t >= a && x.t < b);
    expect(firsts(inRange(r.heard.low, 0, 1.05))).toEqual(firsts(inRange(picks, 0, 1.05)).map((n) => (n as number) + 48));
    expect(inRange(r.heard.high, 0, 1.05)).toEqual([]);
    expect(firsts(inRange(r.heard.high, 1.05, 2.05))).toEqual(firsts(inRange(picks, 1.05, 2.05)).map((n) => (n as number) + 72));
    expect(inRange(r.heard.low, 1.05, 2.05)).toEqual([]);
    expect(firsts(inRange(r.heard.low, 2.05, 3))).toEqual(firsts(inRange(picks, 2.05, 3)).map((n) => (n as number) + 48));
  });
});

describe('matrix~/0: Crossfade two tones', () => {
  it('"each message fades one tone in and the other out over 300 ms, every second"', async () => {
    const r = await render('matrix~', 0, { seconds: 2.5 });
    const full = 0.2;
    expect(amp(r.left, 0.4, 0.95, 220)).toBeCloseTo(full, 2);
    expect(amp(r.left, 0.4, 0.95, 330)).toBeLessThan(0.002);
    expect(amp(r.left, 1.4, 1.95, 330)).toBeCloseTo(full, 2);
    expect(amp(r.left, 1.4, 1.95, 220)).toBeLessThan(0.002);
    expect(amp(r.left, 2.4, 2.5, 220)).toBeCloseTo(full, 1);
  });
  it.fails('BUG (engine): the fade at 1 s starts part-way (linearRampToValueAtTime with no setValueAtTime anchor ramps from the previous event at 0.3 s)', async () => {
    const r = await render('matrix~', 0, { seconds: 1.5 });
    // 0..20 ms into the fade the 220 Hz tone should still be near full (≥ 93%), not dropped to ~30%
    expect(amp(r.left, 1.0, 1.02, 220)).toBeGreaterThan(0.18);
    expect(amp(r.left, 1.14, 1.16, 220)).toBeCloseTo(0.1, 1); // half way at 150 ms
  });
});

describe('pv/0: A value private to this patch', () => {
  it('"One pv counts; another, elsewhere, is read on each beat to choose the note"', async () => {
    const r = await render('pv', 0, { seconds: 2.1, listen: [{ box: 'pv', nth: 1, label: 'read' }, { box: '+' }] });
    expect(firsts(r.heard.read).slice(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 0]);
    expect(firsts(r.heard['+']).slice(0, 7)).toEqual([0, 1, 2, 3, 4, 5, 6].map((k) => ((7 * k) % 12) + 60));
  });
});

describe('receive/0: Messages without a cord', () => {
  it('"forward sends each note to \\"note\\", and two receives turn it into a root and a fifth on two oscillators"', async () => {
    const r = await render('receive', 0, { seconds: 2.5, listen: [{ box: 'receive', nth: 0, label: 'a' }, { box: 'receive', nth: 1, label: 'b' }, { box: '+' }] });
    expect(firsts(r.heard.a)).toEqual([48, 49, 50, 51, 52, 53, 54, 55, 48]);
    expect(firsts(r.heard.b)).toEqual(firsts(r.heard.a));
    expect(firsts(r.heard['+'])).toEqual(firsts(r.heard.a).map((n) => (n as number) + 7));
    expect(amp(r.left, 0.32, 0.58, mtof(49))).toBeCloseTo(0.15, 1);
    expect(amp(r.left, 0.32, 0.58, mtof(56))).toBeCloseTo(0.15, 1);
  });
});

describe('receive~/0: Switch which sender you hear', () => {
  it('"receive~ plays one of them, and the message set high (or set low) re-points it; metro switches every half second"', async () => {
    const r = await render('receive~', 0, { seconds: 2.1 });
    for (const t of [0.05, 1.05]) {
      expect(amp(r.left, t, t + 0.4, 220)).toBeCloseTo(0.2, 2);   // the sine
      expect(amp(r.left, t, t + 0.4, 330)).toBeLessThan(0.005);
    }
    for (const t of [0.55, 1.55]) {
      expect(amp(r.left, t, t + 0.4, 220)).toBeLessThan(0.005);
      expect(amp(r.left, t, t + 0.4, 330)).toBeGreaterThan(0.08);   // the sawtooth's fundamental (2/π·0.2 ≈ 0.13)
      expect(amp(r.left, t, t + 0.4, 660)).toBeGreaterThan(0.04);   // and its harmonics
    }
  });
});

describe('selector~/0: Let a signal through, or not', () => {
  it('"off sends 0 and the tone stops, on sends 1 and it returns" (open to start)', async () => {
    const r = await render('selector~', 0, { seconds: 3, at: [{ t: 1.0, box: 'toggle', msg: [0] }, { t: 2.0, box: 'toggle', msg: [1] }] });
    expect(rms(r.left, 0.1, 0.95)).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(zcFreq(r.left, 0.1, 0.95)).toBeCloseTo(294, 0);
    expect(rms(r.left, 1.05, 1.95)).toBeLessThan(0.001);
    expect(rms(r.left, 2.05, 2.95)).toBeCloseTo(0.2 / Math.SQRT2, 2);
  });
});

describe('send/0: Messages without a cord', () => {
  it('"a metro and counter play a melody into send, and a receive on the far side plays it"', async () => {
    const r = await render('send', 0, { seconds: 2.1, listen: [{ box: 'receive' }] });
    expect(firsts(r.heard.receive).slice(0, 9)).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 60]);
    expect(zcFreq(r.left, 0.52, 0.73)).toBeCloseTo(mtof(62), 0);
  });
});

describe('send~/0: Audio without a cord', () => {
  it('"send~ and receive~ with the same name (\\"tone\\") connect without a patch cord"', async () => {
    const r = await render('send~', 0, { seconds: 0.6 });
    expect(zcFreq(r.left, 0.1, 0.5)).toBeCloseTo(294, 0);
    expect(rms(r.left, 0.1, 0.5)).toBeCloseTo(0.2 / Math.SQRT2, 2);
  });
});

describe('value/0: One number, shared by name', () => {
  it('"One value is set once at start-up; another, elsewhere, is read by each beat, so the melody is built on that root"', async () => {
    const r = await render('value', 0, { seconds: 2.1, listen: [{ box: 'value', nth: 1, label: 'read' }, { box: '+' }] });
    expect(firsts(r.heard.read).slice(0, 5)).toEqual([57, 57, 57, 57, 57]);
    expect(firsts(r.heard['+']).slice(0, 10)).toEqual([57, 58, 59, 60, 61, 57, 58, 59, 60, 61]);
  });
  it('"drag the number box to change the root note"', async () => {
    const r = await render('value', 0, { seconds: 3.1, listen: [{ box: '+' }], at: [{ t: 0.95, box: 'number', msg: [62] }] });
    expect(firsts(r.heard['+'].filter((h) => h.t > 0.99)).slice(0, 5)).toEqual([62, 63, 64, 65, 66]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════
// Noise
// ═════════════════════════════════════════════════════════════════════════════════════

describe('noise~/0: White noise', () => {
  it('"noise~ outputs random values: every frequency at equal strength"', async () => {
    const r = await render('noise~', 0, { seconds: 2.2 });
    expect(rms(r.left, 0.1, 2)).toBeCloseTo(0.1 / Math.sqrt(3), 2); // uniform −1..1, × 0.1
    const lo = bandPower(r.left, 0.1, 2, 300), mid = bandPower(r.left, 0.1, 2, 3000), hi = bandPower(r.left, 0.1, 2, 12000);
    expect(mid / lo).toBeGreaterThan(0.6);
    expect(mid / lo).toBeLessThan(1.6);
    expect(hi / lo).toBeGreaterThan(0.6);
    expect(hi / lo).toBeLessThan(1.6);
  });
});

describe('noise~/1: Wind: noise through a filter', () => {
  it('"lores~ keeps the lows, so the hiss turns into a rumble"', async () => {
    const r = await render('noise~', 1, { seconds: 2.2 });
    const lo = bandPower(r.left, 0.1, 2, 150), hi = bandPower(r.left, 0.1, 2, 4000);
    expect(hi / lo).toBeLessThan(0.02);
  });
  it.fails('BUG (engine): "a pitch-like color" — lores~ 400 0.9 should ring near 400 Hz; the engine passes resonance 0.9 as biquad Q 0.9 (almost no peak)', async () => {
    const r = await render('noise~', 1, { seconds: 2.2 });
    expect(bandPower(r.left, 0.1, 2, 400) / bandPower(r.left, 0.1, 2, 150)).toBeGreaterThan(4); // ≥ +6 dB peak
  });
});

describe('pink~/0: Pink noise', () => {
  it('"pink~ is noise with less energy in the highs than noise~" (−3 dB per octave)', async () => {
    const r = await render('pink~', 0, { seconds: 2.2 });
    const p400 = bandPower(r.left, 0.1, 2, 400), p4k = bandPower(r.left, 0.1, 2, 4000);
    expect(p4k / p400).toBeGreaterThan(0.05);
    expect(p4k / p400).toBeLessThan(0.2); // a decade up: 1/10 the power
  });
});
