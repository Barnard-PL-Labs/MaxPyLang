// Claims audit, group 1: the mc.* examples. Each test quotes the text it holds the example to.
//
// The browser player plays each mc.* object as one channel (its first), in the left speaker,
// so every sound check here reads r.left and the first channel's values. Where the text is
// about channel 2 or about many channels at once, the test says so and checks what one
// channel can show; the Max side of those claims was checked against Max's reference pages
// (msp-ref/*.maxref.xml and the MC user guide) and is noted beside the test.
//
// `it.fails('BUG: ...')` marks a claim that is wrong in the engine or wrong for Max: the
// test asserts what the text (or Max) says, and documents that it does not hold.
import { describe, expect, it, vi } from 'vitest';
import '../../../web/src/objects';
import { Engine } from '../../../web/src/engine/engine';
import { parseMaxPat } from '../../../web/src/parser/maxpat';
import { preloadWorklets } from '../../../web/src/runtime/worklet';
import { SR, boxIds, example, pitch, rms, peak, firsts, type Heard, type Listen } from './helpers/measure';

type Atom = number | string;

// ── A runner that can also "turn a dial" or "type in a number box" at a given time ───────
// The same offline render as helpers/measure.ts run(), plus `sends`: at time t the message
// goes into inlet `inlet` of the named box, as a click or typed number would.
interface Send { t: number; box: string; nth?: number; inlet?: number; msg: Atom[] }
interface Rendered { left: Float32Array; right: Float32Array; heard: Record<string, Heard[]>; dropped: string[] }

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function runX(object: string, index = 0, opts: { seconds?: number; listen?: Listen[]; sends?: Send[] } = {}): Promise<Rendered> {
  const ex = example(object, index);
  const seconds = opts.seconds ?? 2.5;
  const STEP = 0.01;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  const rand = vi.spyOn(Math, 'random').mockImplementation(seeded(1));
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const engine = new Engine(ctx);
  try {
    await preloadWorklets(ctx);
    engine.build(parseMaxPat(ex.patch));
    const nodes = (engine as unknown as { nodes: Map<string, { controlIns?: (((m: Atom[]) => void) | undefined)[]; onControlOut?: (o: number, cb: (m: Atom[]) => void) => void }> }).nodes;
    let now = 0;
    const heard: Record<string, Heard[]> = {};
    for (const l of opts.listen ?? []) {
      const id = boxIds(ex, l.box)[l.nth ?? 0];
      if (!id) throw new Error(`${object}/${index} has no box "${l.box}"`);
      const label = l.label ?? l.box;
      heard[label] = [];
      nodes.get(id)?.onControlOut?.(l.outlet ?? 0, (m) => heard[label].push({ t: now, msg: [...m] }));
    }
    const pending = [...(opts.sends ?? [])].sort((a, b) => a.t - b.t);
    const dropped: string[] = [];
    const deliver = (upTo: number) => {
      while (pending.length && pending[0].t <= upTo + 1e-9) {
        const s = pending.shift()!;
        const id = boxIds(ex, s.box)[s.nth ?? 0];
        const fn = nodes.get(id)?.controlIns?.[s.inlet ?? 0];
        // A box with no handler ignores the message, as the engine would (noted in `dropped`).
        if (fn) fn(s.msg); else dropped.push(`${s.box}:${s.inlet ?? 0}`);
      }
    };
    await engine.start();
    for (let t = STEP; t < seconds; t += STEP) {
      const at = Math.round((t * SR) / 128) * 128 / SR;
      if (at >= ctx.length / SR - 1e-6) break;
      void ctx.suspend(at).then(() => {
        now = at;
        vi.advanceTimersByTime(STEP * 1000);
        deliver(at);
        void ctx.resume();
      });
    }
    const buffer = await ctx.startRendering();
    return { left: buffer.getChannelData(0).slice(), right: buffer.getChannelData(1).slice(), heard, dropped };
  } finally {
    await engine.stop();
    engine.clear();
    rand.mockRestore();
    vi.useRealTimers();
  }
}

// ── Measures ────────────────────────────────────────────────────────────────────────────
const seg = (x: Float32Array, t0: number, t1: number) => x.subarray(Math.round(t0 * SR), Math.round(t1 * SR));

/** Amplitude of the sinusoid at f Hz between t0 and t1 (Hann-windowed DFT bin). */
function amp(x: Float32Array, t0: number, t1: number, f: number): number {
  const s = seg(x, t0, t1), N = s.length;
  let re = 0, im = 0, wsum = 0;
  for (let n = 0; n < N; n++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1));
    const ph = (2 * Math.PI * f * n) / SR;
    re += w * s[n] * Math.cos(ph); im -= w * s[n] * Math.sin(ph); wsum += w;
  }
  return (2 * Math.hypot(re, im)) / wsum;
}

/** Average power near f Hz over many 2048-sample windows: a smoothed noise spectrum. */
function band(x: Float32Array, t0: number, t1: number, f: number): number {
  const W = 2048 / SR;
  let p = 0, n = 0;
  for (let t = t0; t + W <= t1; t += W / 2) { p += amp(x, t, t + W, f) ** 2; n++; }
  return p / n;
}

/** Mean absolute value. */
function meanAbs(x: Float32Array, t0: number, t1: number) {
  const s = seg(x, t0, t1); let a = 0;
  for (const v of s) a += Math.abs(v);
  return a / s.length;
}

/** The envelope of a tone at t: its peak in a short window around t, divided by `gain`. */
const env = (x: Float32Array, t: number, gain: number, half = 0.004) => peak(x, t - half, t + half) / gain;

/** Times (s) at which |x| rises above thr after at least `gap` s below it. */
function onsets(x: Float32Array, thr: number, gap = 0.02, t0 = 0, t1 = x.length / SR): number[] {
  const out: number[] = [];
  let quiet = gap * SR;
  for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) {
    if (Math.abs(x[i]) > thr) { if (quiet >= gap * SR) out.push(i / SR); quiet = 0; } else quiet++;
  }
  return out;
}

/** Distinct sample values (rounded to 1e-5) between t0 and t1. */
function levels(x: Float32Array, t0: number, t1: number): number[] {
  return [...new Set([...seg(x, t0, t1)].map((v) => Math.round(v * 1e5) / 1e5))].sort((a, b) => a - b);
}

/** Largest sample-to-sample change, upward and downward. */
function slopes(x: Float32Array, t0: number, t1: number) {
  const s = seg(x, t0, t1); let up = 0, down = 0;
  for (let i = 1; i < s.length; i++) { const d = s[i] - s[i - 1]; up = Math.max(up, d); down = Math.min(down, d); }
  return { up, down };
}

/** Frequency from upward zero crossings (interpolated) over a window: precise for clean tones. */
function zcFreq(x: Float32Array, t0: number, t1: number): number {
  const s = seg(x, t0, t1); const c: number[] = [];
  for (let i = 1; i < s.length; i++) if (s[i - 1] < 0 && s[i] >= 0) c.push(i - 1 + s[i - 1] / (s[i - 1] - s[i]));
  return c.length < 2 ? 0 : ((c.length - 1) * SR) / (c[c.length - 1] - c[0]);
}

/** RMS of what is left after removing the best-fitting sinusoid at f Hz (least squares). */
function residual(x: Float32Array, t0: number, t1: number, f: number): number {
  const s = seg(x, t0, t1); let cc = 0, ss = 0, cs = 0, xc = 0, xs = 0;
  for (let n = 0; n < s.length; n++) {
    const c = Math.cos((2 * Math.PI * f * n) / SR), sn = Math.sin((2 * Math.PI * f * n) / SR);
    cc += c * c; ss += sn * sn; cs += c * sn; xc += s[n] * c; xs += s[n] * sn;
  }
  const det = cc * ss - cs * cs, A = (xc * ss - xs * cs) / det, B = (xs * cc - xc * cs) / det;
  let e = 0;
  for (let n = 0; n < s.length; n++) {
    const d = s[n] - A * Math.cos((2 * Math.PI * f * n) / SR) - B * Math.sin((2 * Math.PI * f * n) / SR);
    e += d * d;
  }
  return Math.sqrt(e / s.length);
}

/** Mean level between t0 and t1 (for a held, square-ish signal). */
function mean(x: Float32Array, t0: number, t1: number) {
  const s = seg(x, t0, t1); let a = 0;
  for (const v of s) a += v;
  return a / s.length;
}

const saw = (k: number) => 2 / (Math.PI * k); // amplitude of harmonic k of a ±1 sawtooth
const sq = (k: number) => (k % 2 ? 4 / (Math.PI * k) : 0); // ... of a ±1 square wave
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ════════════════════════════════════════════════════════════════════════════════════════

describe('mc.abs~/0: Folding two waves', () => {
  it('"flips the negative half ... upward": no sample below zero; "an octave higher" (110 -> 220 Hz)', async () => {
    const r = await runX('mc.abs~', 0, { seconds: 1 });
    expect(Math.min(...seg(r.left, 0.1, 0.9))).toBeGreaterThan(-1e-4);
    expect(pitch(r.left, 0.2, 0.5)).toBeCloseTo(220, -1);
    expect(amp(r.left, 0.2, 0.8, 110)).toBeLessThan(0.002);              // the 110 Hz fundamental is gone
    // "buzzier": |cos| has harmonics 4/(3π) at 2f, 4/(15π) at 4f (times *~ 0.2)
    expect(amp(r.left, 0.2, 0.8, 220)).toBeCloseTo(0.2 * 4 / (3 * Math.PI), 2);
    expect(amp(r.left, 0.2, 0.8, 440)).toBeCloseTo(0.2 * 4 / (15 * Math.PI), 2);
  });
});

describe('mc.adsr~/0: Two notes, one envelope box', () => {
  it('"counter alternates 1 and 0, so both notes hold for 600 ms, then fade"', async () => {
    const r = await runX('mc.adsr~', 0, { seconds: 2, listen: [{ box: 'counter' }] });
    expect(firsts(r.heard.counter).slice(0, 4)).toEqual([0, 1, 0, 1]);
    const on = r.heard.counter[1].t, off = r.heard.counter[2].t;
    expect(off - on).toBeCloseTo(0.6, 2);
    expect(rms(r.left, 0.1, 0.5)).toBeLessThan(1e-3);                     // 0 first: silent
    expect(pitch(r.left, on + 0.25, on + 0.55)).toBeCloseTo(110, -1);
    // 10 ms attack to 1, 150 ms decay to the 0.5 sustain (peaks of the saw, × 0.15)
    const top = env(r.left, on + 0.012, 0.15, 0.006);
    expect(top).toBeGreaterThan(0.85);
    expect(peak(r.left, on + 0.3, on + 0.58) / 0.15 / top).toBeCloseTo(0.5, 1);
    // 300 ms release after the 0
    expect(rms(r.left, off + 0.1, off + 0.15)).toBeLessThan(rms(r.left, on + 0.3, on + 0.58));
    expect(rms(r.left, off + 0.33, off + 0.55)).toBeLessThan(1e-3);
  });
});

describe('mc.allpass~/0: Clicks that ring', () => {
  // train~ 500 0.01 in Max: a 0/1 pulse 5 ms wide, twice a second.
  it.fails('BUG: "Two click tracks (2 ... a second)": engine train~ is a ±1 square wave (pulse width ignored), not clicks', async () => {
    const r = await runX('mc.allpass~', 0, { seconds: 1.6 });
    const on = onsets(r.left, 0.05, 0.3);
    console.log('EVIDENCE mc.allpass~ onsets', on, 'level 0.1-0.2 s', mean(r.left, 0.1, 0.2));
    expect(on.length).toBe(4);                                              // 0, .5, 1, 1.5: 2 a second
    // the tail: echoes every 23 ms, each 0.8 of the last (allpass~ 100 23 0.8)
    const e1 = peak(r.left, on[0] + 0.020, on[0] + 0.030), e2 = peak(r.left, on[0] + 0.043, on[0] + 0.053);
    expect(e2 / e1).toBeCloseTo(0.8, 1);
  });
  it('"smears sharp sounds in time": after a sharp edge of the input, the output keeps moving, with a step 23 ms later', async () => {
    // The engine's square input flips at 0.25 s and then holds still until 0.5 s.
    const r = await runX('mc.allpass~', 0, { seconds: 0.5 });
    expect(Math.abs(mean(r.left, 0.255, 0.265) - mean(r.left, 0.44, 0.45))).toBeGreaterThan(0.1);
    const D = 0.023;
    expect(Math.abs(mean(r.left, 0.25 + D + 0.0005, 0.25 + D + 0.002) - mean(r.left, 0.25 + D - 0.002, 0.25 + D - 0.0005))).toBeGreaterThan(0.02);
  });
});

describe('mc.avg~/0: The average level of each channel', () => {
  it('"metro bangs it every 100 ms; the number box shows the levels of two plucked tones as they fade"', async () => {
    const r = await runX('mc.avg~', 0, { seconds: 1.05, listen: [{ box: 'mc.avg~' }, { box: 'flonum' }] });
    const h = r.heard['mc.avg~'];
    expect(h.length).toBeGreaterThanOrEqual(10);
    expect(h[2].t - h[1].t).toBeCloseTo(0.1, 2);
    const v = firsts(r.heard.flonum).slice(1, 9) as number[];
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThan(v[i - 1]); // fading
  });
  it.fails('BUG: engine avg~ reports the RMS of the last 2048 samples, not Max\'s average |x| since the previous bang', async () => {
    const r = await runX('mc.avg~', 0, { seconds: 1.05, listen: [{ box: 'mc.avg~' }] });
    const h = r.heard['mc.avg~'];
    console.log('EVIDENCE mc.avg~ reported vs mean|x| since last bang', h.slice(2, 8).map((x, i) => `${(x.msg[0] as number).toFixed(4)}/${meanAbs(r.left, h[i + 1].t, x.t).toFixed(4)}`));
    for (let i = 2; i < 8; i++) expect(h[i].msg[0] as number).toBeCloseTo(meanAbs(r.left, h[i - 1].t, h[i].t), 3);
  });
});

describe('mc.biquad~/0: One filter design, every channel', () => {
  it('"These make an 800 Hz low-pass (for 44.1 kHz)": the coefficients, by Max\'s biquad~ formula', () => {
    const [a0, a1, a2, b1, b2] = [0.003003, 0.006006, 0.003003, -1.839096, 0.851108];
    const H = (f: number) => {
      const w = (2 * Math.PI * f) / SR;
      const nr = a0 + a1 * Math.cos(w) + a2 * Math.cos(2 * w), ni = -(a1 * Math.sin(w) + a2 * Math.sin(2 * w));
      const dr = 1 + b1 * Math.cos(w) + b2 * Math.cos(2 * w), di = -(b1 * Math.sin(w) + b2 * Math.sin(2 * w));
      return Math.hypot(nr, ni) / Math.hypot(dr, di);
    };
    expect(H(0)).toBeCloseTo(1, 3);
    expect(H(800)).toBeCloseTo(Math.SQRT1_2, 1);                            // -3 dB at 800 Hz
    expect(H(3200)).toBeLessThan(0.1);
  });
  it('"two sawtooths ... both sound muffled": 110 Hz saw, harmonics above 800 Hz cut', async () => {
    const r = await runX('mc.biquad~', 0, { seconds: 1 });
    expect(pitch(r.left, 0.2, 0.5)).toBeCloseTo(110, -1);
    // harmonic k of a saw is 1/k of the fundamental; after the filter the 30th (3300 Hz) is far less
    const g = (k: number) => (amp(r.left, 0.2, 0.9, 110 * k) * k) / amp(r.left, 0.2, 0.9, 110);
    expect(g(2)).toBeGreaterThan(0.9);                                        // 220 Hz passes
    expect(g(30)).toBeLessThan(0.1);                                          // 3300 Hz is cut
  });
});

describe('mc.clip~/0: Distortion on two channels', () => {
  it('"boosts two sines to 5 times ... then mc.clip~ cuts every channel at -0.3 and 0.3"', async () => {
    const r = await runX('mc.clip~', 0, { seconds: 1 });
    expect(peak(r.left, 0.1, 0.9)).toBeCloseTo(0.3 * 0.2, 3);
    expect(Math.min(...seg(r.left, 0.1, 0.9))).toBeCloseTo(-0.3 * 0.2, 3);
    // "flattened peaks": 5 sin(x) is beyond ±0.3 for all but asin(0.06)·4/2π ≈ 4% of the time
    const s = seg(r.left, 0.1, 0.9);
    const flat = s.filter((v) => Math.abs(Math.abs(v) - 0.06) < 1e-4).length / s.length;
    expect(flat).toBeGreaterThan(0.9);
    expect(pitch(r.left, 0.2, 0.5)).toBeCloseTo(196, -1);
  });
});

describe('mc.comb~/0: Metallic noise, left and right', () => {
  it('"a 5 ms delay fed back at 0.9 gives two noise streams a pitch near 200 Hz"', async () => {
    const r = await runX('mc.comb~', 0, { seconds: 1.5 });
    expect(pitch(r.left, 0.3, 1.4)).toBeCloseTo(200, -1);
    // comb~ a=0.3, c=0.9: white noise (rms 1/√3) × 0.3 / √(1-0.81) × 0.05
    expect(rms(r.left, 0.3, 1.4)).toBeCloseTo((0.3 / Math.sqrt(3) / Math.sqrt(1 - 0.81)) * 0.05, 2);
    expect(band(r.left, 0.3, 1.4, 400) / band(r.left, 0.3, 1.4, 500)).toBeGreaterThan(10); // peaks at 200·k
  });
  it('"Turn the dial to change the feedback, from dry (0) to ringing (0.95)"', async () => {
    const r = await runX('mc.comb~', 0, { seconds: 2.4, sends: [{ t: 0.2, box: 'dial', msg: [0] }, { t: 1.2, box: 'dial', msg: [127] }] });
    const dry = (0.3 / Math.sqrt(3)) * 0.05;
    expect(rms(r.left, 0.4, 1.1)).toBeCloseTo(dry, 3);
    expect(band(r.left, 0.4, 1.1, 400) / band(r.left, 0.4, 1.1, 500)).toBeCloseTo(1, 0); // flat: no pitch
    expect(rms(r.left, 1.6, 2.3)).toBeCloseTo(dry / Math.sqrt(1 - 0.95 ** 2), 2);
  });
});

describe('mc.cross~/0: Splitting highs from lows', () => {
  it('"lows from the left outlet, highs from the right. This plays only the highs"', async () => {
    const r = await runX('mc.cross~', 0, { seconds: 1 });
    // harmonic k × k: what the filter left of a saw's 1/k, relative to the 60th (6600 Hz, surely passed)
    const g = (k: number) => (amp(r.left, 0.2, 0.9, 110 * k) * k) / (amp(r.left, 0.2, 0.9, 6600) * 60);
    expect(g(1)).toBeLessThan(0.02);                                          // 110 Hz, far below 1000: gone
    expect(g(30)).toBeCloseTo(1, 0);                                          // 3300 Hz passes
  });
  it('"turn the dial to move the split from 200 to 4000 Hz"', async () => {
    const r = await runX('mc.cross~', 0, { seconds: 2.2, sends: [{ t: 0.1, box: 'dial', msg: [0] }, { t: 1.1, box: 'dial', msg: [127] }] });
    const g = (t0: number, t1: number, k: number) => (amp(r.left, t0, t1, 110 * k) * k) / (amp(r.left, t0, t1, 8800) * 80);
    expect(g(0.3, 1.0, 3)).toBeGreaterThan(0.6);                              // split at 200: 330 Hz passes
    expect(g(1.3, 2.1, 10)).toBeLessThan(0.1);                                // split at 4000: 1100 Hz cut
  });
});

describe('mc.curve~/0: Curved fades on two voices', () => {
  it('"Each segment is target, time and curve": up to 1 in 5 ms, then an 800 ms fade, every second', async () => {
    const r = await runX('mc.curve~', 0, { seconds: 2.2 });
    expect(pitch(r.left, 0.02, 0.15)).toBeCloseTo(330, -1);
    expect(env(r.left, 0.01, 0.2)).toBeGreaterThan(0.9);
    expect(env(r.left, 0.82, 0.2)).toBeLessThan(0.03);                       // done by 805 ms
    expect(env(r.left, 1.01, 0.2)).toBeGreaterThan(0.9);                     // again a second later
  });
  // Max's curve~ help builds an "s" curve from 1 to 0 as "1., 0.5 500 0.5 0. 500 -0.5": a
  // positive curve starts slow whichever way the ramp goes, so 0.8 holds near 1 and drops late.
  // The text says the opposite. The engine (setTargetAtTime then linearRampToValueAtTime) comes
  // out a straight line: 0.75 / 0.50 / 0.25 at 25 / 50 / 75 %, so neither shape is heard.
  it.fails('BUG: "a curve of 0.8 makes the 800 ms fade drop fast, then linger" is backwards for Max (0.8 starts slow); the engine fades in a straight line', async () => {
    const r = await runX('mc.curve~', 0, { seconds: 1 });
    console.log('EVIDENCE mc.curve~ envelope at 25/50/75% of the fade', [0.2, 0.4, 0.6].map((t) => env(r.left, 0.005 + t, 0.2).toFixed(3)));
    // Max with curve 0.8: a quarter of the way into the fade it is still above the straight line
    expect(env(r.left, 0.005 + 0.2, 0.2)).toBeGreaterThan(0.8);
  });
});

describe('mc.curve~/0 (engine shape)', () => {
  it.fails('BUG: engine curve~ ignores the curve parameter: "drop fast, then linger" (below the straight line) is not heard either', async () => {
    const r = await runX('mc.curve~', 0, { seconds: 1 });
    expect(env(r.left, 0.005 + 0.2, 0.2)).toBeLessThan(0.65);
  });
});

describe('mc.cycle~/0: Two sines from one box', () => {
  it('"one box plays 220 Hz on the left" (and 330 on the right in Max)', async () => {
    const r = await runX('mc.cycle~', 0, { seconds: 1 });
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(220, 0);
    expect(rms(r.left, 0.1, 0.9)).toBeCloseTo(0.2 / Math.SQRT2, 3);
  });
  // Max's cycle~ reads a cosine table: it starts at its peak. This matters to every example
  // that uses a slow mc.cycle~ as a control (mc.edge~, mc.thresh~, mc.snapshot~, mc.route).
  it.fails('BUG: engine cycle~ is a Web Audio sine (starts at 0), Max\'s cycle~ is a cosine (starts at 1)', async () => {
    const r = await runX('mc.cycle~', 0, { seconds: 0.1 });
    console.log('EVIDENCE mc.cycle~ first samples', [...r.left.subarray(0, 4)].map((v) => v.toFixed(4)));
    expect(r.left[0]).toBeCloseTo(0.2, 2);
  });
});

describe('mc.degrade~/0: Lo-fi on every channel', () => {
  it('"0.2 of the rate and 4 bits": each value held 5 samples, on a 4-bit grid', async () => {
    const r = await runX('mc.degrade~', 0, { seconds: 1 });
    const L = levels(r.left, 0.1, 0.9);
    expect(L.length).toBeLessThanOrEqual(17);                                // 2^4 steps across -1..1
    expect(L.length).toBeGreaterThanOrEqual(8);
    const s = seg(r.left, 0.1, 0.2); let changes = 0;
    for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) changes++;
    expect(s.length / changes).toBeGreaterThan(4.5);                          // held ~5 samples
    expect(pitch(r.left, 0.2, 0.5)).toBeCloseTo(330, -1);
  });
  it('"Type a bit depth from 1 to 24 in the number box"', async () => {
    const r = await runX('mc.degrade~', 0, { seconds: 1, sends: [{ t: 0.2, box: 'number', msg: [24] }] });
    expect(levels(r.left, 0.4, 0.9).length).toBeGreaterThan(100);
  });
});

describe('mc.delay~/0: Echoes on two click tracks', () => {
  it.fails('BUG: "Adding the delayed clicks to the dry ones doubles each click track": engine train~ is a ±1 square, not clicks', async () => {
    const r = await runX('mc.delay~', 0, { seconds: 1.4 });
    const on = onsets(r.left, 0.1, 0.05);
    console.log('EVIDENCE mc.delay~ onsets (samples)', on.map((t) => Math.round(t * SR)), 'level 0.02-0.24 s', mean(r.left, 0.02, 0.24));
    expect(on.slice(0, 4).map((t) => Math.round(t * SR))).toEqual([0, 11025, 44100, 44100 + 11025]);
    expect(rms(r.left, 0.02, 0.24)).toBeLessThan(1e-4);
  });
  it('"delays every channel by a number of samples: 11025, a quarter second"', async () => {
    // With the engine's square (+a for 0.5 s, -a for 0.5 s), dry + delayed is a, 2a, 0, -2a by quarters
    const r = await runX('mc.delay~', 0, { seconds: 1 });
    const a = mean(r.left, 0.02, 0.24);
    expect(a).toBeGreaterThan(0.1);
    expect(mean(r.left, 0.27, 0.49) / a).toBeCloseTo(2, 1);
    expect(mean(r.left, 0.52, 0.74) / a).toBeCloseTo(0, 1);
    expect(mean(r.left, 0.77, 0.99) / a).toBeCloseTo(-2, 1);
    const jump = [...seg(r.left, 0.24, 0.26)].findIndex((v) => v > 1.5 * a) + Math.round(0.24 * SR);
    expect(Math.abs(jump - 11025)).toBeLessThanOrEqual(4);                   // within the band-limited edge
  });
});

describe('mc.deltaclip~/0: Slowing the jumps', () => {
  it('"limits how far each channel may move from one sample to the next ... edges become slopes"', async () => {
    const r = await runX('mc.deltaclip~', 0, { seconds: 1 });
    const s = slopes(r.left, 0.1, 0.9);
    expect(s.up).toBeLessThanOrEqual(0.01 * 0.2 + 1e-5);
    expect(s.down).toBeGreaterThanOrEqual(-0.01 * 0.2 - 1e-5);
    expect(s.up).toBeGreaterThan(0.009 * 0.2);                               // it does move at the limit
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(110, 0);
    // "the sound turns soft": the 9th harmonic falls far below a square's
    expect(amp(r.left, 0.2, 0.9, 990) / (0.2 * sq(9))).toBeLessThan(0.3);
  });
});

describe('mc.div~/0: Divide every channel', () => {
  it('"440 and 660, divided by 2 play 220 and 330 Hz. Type 4 in the number box and both drop another octave"', async () => {
    const r = await runX('mc.div~', 0, { seconds: 1.4, sends: [{ t: 0.7, box: 'number', msg: [4] }] });
    expect(zcFreq(r.left, 0.1, 0.65)).toBeCloseTo(220, 0);
    expect(zcFreq(r.left, 0.8, 1.35)).toBeCloseTo(110, 0);
  });
});

describe('mc.edge~/0: A melody stepped by two signals', () => {
  // In Max the 2 Hz and 3 Hz channels together start up 5 times a second; one channel here: 2.
  it('"bangs when any channel goes from zero to non-zero ... each bang steps counter up a scale"', async () => {
    const r = await runX('mc.edge~', 0, { seconds: 2.2, listen: [{ box: 'mc.edge~' }, { box: 'counter' }, { box: 'mtof' }] });
    const t = r.heard['mc.edge~'].map((h) => h.t);
    // the 2 Hz channel starts up twice a second
    expect(t.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < 4; i++) expect(t[i] - t[i - 1]).toBeCloseTo(0.5, 1);
    expect(Math.abs((t[3] - t[0]) / 3 - 0.5)).toBeLessThan(0.01);
    const steps = firsts(r.heard.counter) as number[];
    expect(steps[0]).toBe(60);
    for (let i = 1; i < steps.length; i++) expect(steps[i] - steps[i - 1]).toBe(1);
    const last = r.heard.mtof.filter((h) => h.t < 1.3).at(-1)!;
    expect(zcFreq(r.left, last.t + 0.05, 1.35)).toBeCloseTo(last.msg[0] as number, 0);
  });
  // Max: cos 2 Hz clipped at 0 is back above zero at 0.375, 0.875, 1.375 s (cycle~ is a cosine).
  it.fails('BUG: edges come at the wrong times (engine cycle~ is a sine: 0, 0.5, 1 s instead of 0.375, 0.875, 1.375 s)', async () => {
    const r = await runX('mc.edge~', 0, { seconds: 1.5, listen: [{ box: 'mc.edge~' }] });
    const t = r.heard['mc.edge~'].map((h) => h.t);
    console.log('EVIDENCE mc.edge~ bangs at', t.map((x) => x.toFixed(3)));
    for (const [i, x] of t.slice(0, 3).entries()) expect(Math.abs(x - (0.375 + 0.5 * i))).toBeLessThan(0.015);
  });
});

describe('mc.ezdac~/0: Stereo through one cord', () => {
  it('"sends channel 1 to the left speaker": the low (196 Hz) triangle', async () => {
    const r = await runX('mc.ezdac~', 0, { seconds: 1 });
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(196, 0);
    expect(rms(r.left, 0.1, 0.9)).toBeCloseTo(0.2 / Math.sqrt(3), 3);         // ±1 triangle
  });
});

describe('mc.gain~/0: One fader for every channel', () => {
  it('"loadbang sets it to 128, full volume" (gain~: 128 = ×1.0)', async () => {
    const r = await runX('mc.gain~', 0, { seconds: 1 });
    expect(rms(r.left, 0.2, 0.9)).toBeCloseTo(0.2 / Math.SQRT2, 3);
    expect(zcFreq(r.left, 0.2, 0.9)).toBeCloseTo(294, 0);
  });
  // gain~ ref: "128 is full scale ... A change of 10 in the slider produces a 6 dB change".
  it.fails('BUG: "drag it down to fade": engine gain~ is a fixed ×1 GainNode; it takes no slider value (118 should be -6 dB)', async () => {
    const r = await runX('mc.gain~', 0, { seconds: 1, sends: [{ t: 0.3, box: 'mc.gain~', msg: [118] }] });
    console.log('EVIDENCE mc.gain~ dropped messages', r.dropped, 'level ratio', rms(r.left, 0.5, 0.9) / rms(r.left, 0.1, 0.28));
    expect(rms(r.left, 0.5, 0.9) / rms(r.left, 0.1, 0.28)).toBeCloseTo(10 ** (-6 / 20), 1);
  });
});

describe('mc.gate~/0: Switching a chord on and off', () => {
  it('"passes ... when its left inlet gets 1, and silences them all on 0 ... stutters four times a second"', async () => {
    const r = await runX('mc.gate~', 0, { seconds: 1.1, listen: [{ box: 'counter' }] });
    expect(firsts(r.heard.counter).slice(0, 4)).toEqual([0, 1, 0, 1]);
    for (let k = 0; k < 4; k++) {
      const on = 0.125 + 0.25 * k;
      expect(rms(r.left, on + 0.02, on + 0.1)).toBeCloseTo(0.2 / Math.SQRT2, 2);
      expect(rms(r.left, on + 0.145, on + 0.225)).toBeLessThan(1e-3);
    }
    expect(zcFreq(r.left, 0.15, 0.24)).toBeCloseTo(262, -1);
  });
});

describe('mc.limi~/0: Too loud, made safe', () => {
  it('"Two sines boosted to 4 times full scale": a limited 262 Hz tone, near full scale', async () => {
    const r = await runX('mc.limi~', 0, { seconds: 1.5 });
    expect(peak(r.left, 0.3, 1.5)).toBeGreaterThan(0.2 * 0.9);               // "just enough", not much more
    expect(peak(r.left, 0.3, 1.5)).toBeLessThan(0.2 * 1.25);                 // far below the 4× input
    expect(zcFreq(r.left, 0.3, 1.4)).toBeCloseTo(262, 0);
  });
  // limi~ (Max): a lookahead brick-wall limiter, threshold 0 dB. The engine uses a Web Audio
  // DynamicsCompressorNode (threshold -1 dB, ratio 20), whose automatic make-up gain lifts it over 1.
  it.fails('BUG: "to stay within -1..1": engine limi~ (DynamicsCompressorNode with make-up gain) peaks at 1.08', async () => {
    const r = await runX('mc.limi~', 0, { seconds: 1.5 });
    console.log('EVIDENCE mc.limi~ peak before *~ 0.2:', peak(r.left, 0.3, 1.5) / 0.2);
    expect(peak(r.left, 0.3, 1.5)).toBeLessThanOrEqual(0.2 * 1.0 + 1e-4);
  });
});

describe('mc.line~/0: Plucking a chord', () => {
  it('"up in 10 ms, down over 400 ms, so a two-note chord plucks every 600 ms"', async () => {
    const r = await runX('mc.line~', 0, { seconds: 1.3 });
    const on = onsets(r.left, 0.01, 0.1);
    expect(on.length).toBe(3);
    expect(on[1] - on[0]).toBeCloseTo(0.6, 2);
    expect(env(r.left, on[0] + 0.01, 0.2)).toBeGreaterThan(0.95);
    expect(env(r.left, on[0] + 0.21, 0.2)).toBeCloseTo(0.5, 1);            // halfway down
    expect(env(r.left, on[0] + 0.45, 0.2)).toBeLessThan(0.01);
    expect(zcFreq(r.left, on[0] + 0.02, on[0] + 0.3)).toBeCloseTo(440, 0);
  });
});

describe('mc.lores~/0: One dial, two filters', () => {
  // harmonic k of the 98 Hz saw, × k, relative to the fundamental: the filter's gain there
  const g = (x: Float32Array, t0: number, t1: number, k: number) => (amp(x, t0, t1, 98 * k) * k) / amp(x, t0, t1, 98);
  it('"Two sawtooths go through it at an 800 Hz cutoff": 784 Hz passes, 2940 Hz is cut', async () => {
    const r = await runX('mc.lores~', 0, { seconds: 1 });
    expect(g(r.left, 0.2, 0.9, 8)).toBeGreaterThan(0.7);
    expect(g(r.left, 0.2, 0.9, 30)).toBeLessThan(0.2);
  });
  it('"turn the dial to sweep both filters together, from 200 to 3000 Hz"', async () => {
    const r = await runX('mc.lores~', 0, { seconds: 2.2, sends: [{ t: 0.1, box: 'dial', msg: [0] }, { t: 1.1, box: 'dial', msg: [127] }] });
    expect(g(r.left, 0.3, 1.0, 8)).toBeLessThan(0.2);                        // 200 Hz: 784 cut
    expect(g(r.left, 1.3, 2.1, 30)).toBeGreaterThan(0.7);                    // 3000 Hz: 2940 passes
  });
});

describe('mc.matrix~/0: Mixing two multichannel inputs', () => {
  it('"\\"0 0 0.5\\" sends input 0 (a chord) at half level and \\"1 0 0.05\\" adds a little of input 1 (noise)"', async () => {
    const r = await runX('mc.matrix~', 0, { seconds: 1 });
    expect(amp(r.left, 0.2, 0.9, 220)).toBeCloseTo(0.5 * 0.3, 2);
    // what is left after the tone: noise of rms 1/√3 × 0.05 × 0.3
    expect(residual(r.left, 0.2, 0.9, 220)).toBeCloseTo((0.05 * 0.3) / Math.sqrt(3), 3);
  });
});

describe('mc.noise~/0: Stereo noise from one box', () => {
  it('"two separate streams of white noise": white (flat spectrum), level 0.1', async () => {
    const r = await runX('mc.noise~', 0, { seconds: 1.5 });
    expect(rms(r.left, 0.1, 1.4)).toBeCloseTo(0.1 / Math.sqrt(3), 3);
    expect(band(r.left, 0.1, 1.4, 5000) / band(r.left, 0.1, 1.4, 300)).toBeCloseTo(1, 0);
  });
});

describe('mc.number~/0: Watching a multichannel signal', () => {
  it('"Two slow ramps from mc.phasor~ also shape two tones": 0.5 Hz ramp on 262 Hz', async () => {
    const r = await runX('mc.number~', 0, { seconds: 2.2 });
    expect(env(r.left, 0.5, 0.2)).toBeCloseTo(0.25, 1);
    expect(env(r.left, 1.5, 0.2)).toBeCloseTo(0.75, 1);
    expect(env(r.left, 2.05, 0.2)).toBeLessThan(0.1);                       // wrapped at 2 s
    expect(zcFreq(r.left, 1.0, 1.9)).toBeCloseTo(262, 0);
  });
  it('"displays the value of one channel ... at a time": the sampled values come out the middle outlet', async () => {
    const r = await runX('mc.number~', 0, { seconds: 1.2, listen: [{ box: 'mc.number~', outlet: 1 }] });
    const h = r.heard['mc.number~'];
    expect(h.length).toBeGreaterThan(5);
    for (const x of h.filter((x) => x.t > 0.1)) expect(x.msg[0] as number).toBeCloseTo((0.5 * x.t) % 1, 1);
  });
});

describe('mc.onepole~/0: Darker noise, both sides', () => {
  // one-pole y += a(x - y), a = 1 - e^(-2πf/SR): white noise out has rms × √(a/(2-a))
  const gain = (f: number) => { const a = 1 - Math.exp((-2 * Math.PI * f) / SR); return Math.sqrt(a / (2 - a)); };
  it('"Two streams of noise come out at 500 Hz as a soft roar; drag the slider to open both filters up to 5000 Hz"', async () => {
    const r = await runX('mc.onepole~', 0, { seconds: 2.2, sends: [{ t: 1.1, box: 'slider', msg: [127] }] });
    const white = 0.2 / Math.sqrt(3);
    expect(rms(r.left, 0.2, 1.05) / (white * gain(500))).toBeCloseTo(1, 1);
    expect(band(r.left, 0.2, 1.05, 4000) / band(r.left, 0.2, 1.05, 250)).toBeCloseTo((1 + 0.25) / (1 + 64), 1); // 6 dB/oct
    expect(rms(r.left, 1.3, 2.15) / (white * gain(5000))).toBeCloseTo(1, 1);
  });
});

describe('mc.overdrive~/0: Overdrive on every channel', () => {
  it('"a drive of 4 squares off two low sines, 110 ...": flat tops, strong odd harmonics', async () => {
    const r = await runX('mc.overdrive~', 0, { seconds: 1 });
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(110, 0);
    expect(peak(r.left, 0.1, 0.9) / rms(r.left, 0.1, 0.9)).toBeLessThan(1.25); // a sine is 1.41, a square 1
    expect(amp(r.left, 0.2, 0.9, 330) / amp(r.left, 0.2, 0.9, 110)).toBeGreaterThan(0.15);
  });
});

describe('mc.peakamp~/0: Measuring every channel', () => {
  it('"reports the loudest sample of each channel every 250 ms ... the number box shows their peaks falling"', async () => {
    const r = await runX('mc.peakamp~', 0, { seconds: 2.1, listen: [{ box: 'mc.peakamp~' }, { box: 'flonum' }] });
    const h = r.heard['mc.peakamp~'];
    expect(h.length).toBeGreaterThanOrEqual(7);
    expect(h[2].t - h[1].t).toBeCloseTo(0.25, 2);
    const v = firsts(r.heard.flonum).slice(0, 7) as number[];
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThan(v[i - 1]);
  });
  it.fails('BUG: engine peakamp~ only looks at the last 2048 samples at each report, not at the whole 250 ms since the last one', async () => {
    const r = await runX('mc.peakamp~', 0, { seconds: 2.1, listen: [{ box: 'mc.peakamp~' }] });
    const h = r.heard['mc.peakamp~'];
    console.log('EVIDENCE mc.peakamp~ reported vs true window peak', h.slice(1, 7).map((x, i) => `${(x.msg[0] as number).toFixed(4)}/${peak(r.left, h[i].t, x.t).toFixed(4)}`));
    for (let i = 1; i < 7; i++) expect(h[i].msg[0] as number).toBeCloseTo(peak(r.left, h[i - 1].t, h[i].t), 3);
  });
  it.fails('BUG: "the channel number comes out the right outlet": the engine\'s mc.peakamp~ has no voice outlet', async () => {
    const r = await runX('mc.peakamp~', 0, { seconds: 1.1, listen: [{ box: 'mc.peakamp~', outlet: 1, label: 'voice' }] });
    expect(firsts(r.heard.voice).slice(0, 3)).toEqual([1, 1, 1]);
  });
});

describe('mc.phasor~/0: Two against three', () => {
  it('"a 0..1 ramp per channel, at 2 ... Hz ... swelling pulses, two a second on the left"', async () => {
    const r = await runX('mc.phasor~', 0, { seconds: 1.2 });
    expect(env(r.left, 0.1, 0.2)).toBeCloseTo(0.2, 1);
    expect(env(r.left, 0.4, 0.2)).toBeCloseTo(0.8, 1);
    expect(env(r.left, 0.55, 0.2)).toBeCloseTo(0.1, 1);                      // starts again at 0.5 s
    expect(env(r.left, 0.9, 0.2)).toBeCloseTo(0.8, 1);
    expect(zcFreq(r.left, 0.3, 0.49)).toBeCloseTo(440, 0);
  });
});

describe('mc.pink~/0: Soft stereo rain', () => {
  it('"Pink noise has less treble than white": -3 dB per octave', async () => {
    const r = await runX('mc.pink~', 0, { seconds: 2 });
    // 250 -> 4000 Hz is 4 octaves: power falls by 16
    expect(band(r.left, 0.2, 1.9, 4000) / band(r.left, 0.2, 1.9, 250)).toBeGreaterThan(1 / 32);
    expect(band(r.left, 0.2, 1.9, 4000) / band(r.left, 0.2, 1.9, 250)).toBeLessThan(1 / 8);
    expect(rms(r.left, 0.2, 1.9)).toBeGreaterThan(0.01);
  });
});

describe('mc.plus~/0: Vibrato on every channel', () => {
  it('"scaled to ±15 and then raised to 330, so each ... tone wavers around 330 Hz" (4 Hz)', async () => {
    const r = await runX('mc.plus~', 0, { seconds: 1.2 });
    // frequency in 20 ms windows: 330 ± 15, one swing every 0.25 s
    const f: number[] = [];
    for (let t = 0.1; t < 1.1; t += 0.005) f.push(zcFreq(r.left, t, t + 0.02));
    expect(Math.max(...f)).toBeCloseTo(345, -0.5);
    expect(Math.min(...f)).toBeCloseTo(315, -0.5);
    expect(zcFreq(r.left, 0.1, 1.1)).toBeCloseTo(330, 0);
    const tops = f.map((v, i) => (i > 0 && i < f.length - 1 && v >= f[i - 1] && v > f[i + 1] && v > 340 ? 0.1 + i * 0.005 : -1)).filter((t) => t >= 0);
    expect((tops.at(-1)! - tops[0]) / (tops.length - 1)).toBeCloseTo(0.25, 1);  // 4 Hz
  });
});

describe('mc.rampsmooth~/0: Smoothing square waves', () => {
  it('"40 samples round off two square waves": no step faster than 2/40 per sample', async () => {
    const r = await runX('mc.rampsmooth~', 0, { seconds: 1 });
    const s = slopes(r.left, 0.1, 0.9);
    expect(s.up).toBeLessThan(0.2 * (2.2 / 40));                              // rect~ is ±1 (a little overshoot)
    expect(-s.down).toBeLessThan(0.2 * (2.2 / 40));
    expect(s.up).toBeGreaterThan(0.2 * (1.5 / 40));
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(147, 0);
  });
  // rampsmooth~'s inlet 1 is "Ramp up" only (inlet 2 is ramp down): the number box softens the
  // rising edges and leaves the falling ones at 40 samples.
  it('"type a larger number to soften them more" (inlet 1 = ramp up, per Max)', async () => {
    const r = await runX('mc.rampsmooth~', 0, { seconds: 1, sends: [{ t: 0.2, box: 'number', msg: [400] }] });
    const s = slopes(r.left, 0.4, 0.9);
    expect(s.up).toBeLessThan(0.2 * (2.2 / 400));                            // rising edges much softer
  });
});

describe('mc.rdiv~/0: From period to pitch', () => {
  // rdiv~ in the engine is a 1/x WaveShaper curve over -1..1; near x = 0.005 its linear
  // interpolation between table points is coarse.
  it.fails('BUG: "1 divided by periods of 0.005 ... gives 200 Hz": engine rdiv~ (WaveShaper table) gives ~202 Hz', async () => {
    const r = await runX('mc.rdiv~', 0, { seconds: 1 });
    console.log('EVIDENCE mc.rdiv~ frequency', zcFreq(r.left, 0.1, 0.9));
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(200, 0);
  });
});

describe('mc.receive~/0: Receiving two sources by name', () => {
  it('"Two senders named \\"bus\\", one with a chord and one with soft noise, arrive mixed in one box"', async () => {
    const r = await runX('mc.receive~', 0, { seconds: 1 });
    expect(amp(r.left, 0.2, 0.9, 330)).toBeCloseTo(0.2, 2);                  // cycle~ 330 × 0.2
    expect(residual(r.left, 0.2, 0.9, 330)).toBeCloseTo((0.1 * 0.2) / Math.sqrt(3), 3);             // noise × 0.1 × 0.2
  });
});

describe('mc.rect~/0: Two square waves a fifth apart', () => {
  it('"98 Hz ... mc.lores~ then softens both channels"', async () => {
    const r = await runX('mc.rect~', 0, { seconds: 1 });
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(98, 0);
    expect(amp(r.left, 0.2, 0.9, 294) / (0.15 * sq(3))).toBeCloseTo(1, 0);  // below 900: passes
    expect(amp(r.left, 0.2, 0.9, 3038) / (0.15 * sq(31))).toBeLessThan(0.15); // well above: softened
  });
});

describe('mc.reson~/0: Noise that rings at two pitches', () => {
  it('"mc.sig~ gives each channel its own center frequency, so two noise streams whistle at 440"', async () => {
    const r = await runX('mc.reson~', 0, { seconds: 2 });
    const at = (f: number) => band(r.left, 0.2, 1.9, f);
    expect(at(440) / at(600)).toBeGreaterThan(20);
    expect(at(440) / at(300)).toBeGreaterThan(20);
    expect(pitch(r.left, 0.5, 0.7)).toBeCloseTo(440, -1.5);
  });
});

describe('mc.rminus~/0: Plucks from ramps', () => {
  it('"1 minus a rising 0..1 ramp is a falling one, so two tones pluck, twice a second on the left"', async () => {
    const r = await runX('mc.rminus~', 0, { seconds: 1.2 });
    expect(env(r.left, 0.1, 0.2)).toBeCloseTo(0.8, 1);
    expect(env(r.left, 0.4, 0.2)).toBeCloseTo(0.2, 1);
    expect(env(r.left, 0.6, 0.2)).toBeCloseTo(0.8, 1);
    expect(zcFreq(r.left, 0.02, 0.3)).toBeCloseTo(523, 0);
  });
});

describe('mc.round~/0: Stair-step sines', () => {
  it('"With 0.25 two smooth sines become coarse steps": the 220 Hz sine, mostly on the steps', async () => {
    const r = await runX('mc.round~', 0, { seconds: 1 });
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(220, 0);
    const s = seg(r.left, 0.1, 0.9);
    const onStep = s.filter((v) => Math.abs(v / 0.05 - Math.round(v / 0.05)) < 1e-3).length / s.length;
    expect(onStep).toBeGreaterThan(0.5);
  });
  // The engine's round~ is a 4096-point WaveShaper staircase; the shaper interpolates between
  // table points, so every step edge becomes a short ramp of in-between values.
  it.fails('BUG: "rounds every sample ... to a multiple of its argument": engine round~ (interpolated WaveShaper) outputs values between the steps', async () => {
    const r = await runX('mc.round~', 0, { seconds: 1.4, sends: [{ t: 0.7, box: 'flonum', msg: [0.05] }] });
    const a = levels(r.left, 0.1, 0.65);
    console.log('EVIDENCE mc.round~ distinct levels with 0.25:', a.length, 'e.g.', a.slice(0, 8));
    expect(a.length).toBe(9);                                                // -1, -0.75 ... 1
    for (const v of a) expect(Math.abs(v / 0.05 - Math.round(v / 0.05))).toBeLessThan(1e-3);
    const b = levels(r.left, 0.8, 1.35);
    expect(b.length).toBe(41);
    for (const v of b) expect(Math.abs(v / 0.01 - Math.round(v / 0.01))).toBeLessThan(1e-3);
  });
});

describe('mc.route/0: One outlet per channel', () => {
  // mc.route ref: "mc.route 2" has 2 outlets, the left for voice 1. The engine has no mc.route and
  // falls back to Max's plain `route 2`, which matches messages whose first item is 2: every value
  // leaves by the reject outlet (to the flonum) and scale never hears anything.
  it.fails('BUG: "Channel 1 ... steps the pitch of cycle~": engine runs mc.route as `route 2`; nothing reaches scale', async () => {
    const r = await runX('mc.route', 0, { seconds: 2.2, listen: [{ box: 'mc.snapshot~' }, { box: 'scale' }, { box: 'flonum' }] });
    console.log('EVIDENCE mc.route: snapshot sent', r.heard['mc.snapshot~'].length, 'scale heard', r.heard.scale.length, 'flonum heard', r.heard.flonum.length);
    expect(r.heard['mc.snapshot~'].length).toBeGreaterThanOrEqual(15);
    const sc = r.heard.scale;
    expect(sc.length).toBeGreaterThanOrEqual(15);
    for (const h of sc) { expect(h.msg[0] as number).toBeGreaterThanOrEqual(220); expect(h.msg[0] as number).toBeLessThanOrEqual(440); }
    const last = sc.filter((h) => h.t < 1.5).at(-1)!;
    expect(zcFreq(r.left, last.t + 0.02, last.t + 0.11)).toBeCloseTo(last.msg[0] as number, 0);
  });
});

describe('mc.saw~/0: A wide, detuned sawtooth', () => {
  it('"110 Hz and 110.8 Hz. Each speaker gets one": 110 Hz on the left', async () => {
    const r = await runX('mc.saw~', 0, { seconds: 1.2 });
    expect(zcFreq(r.left, 0.1, 1.1)).toBeCloseTo(110, 0);
    expect(rms(r.left, 0.1, 1.1)).toBeGreaterThan(0.05);
  });
});

describe('mc.selector~/0: Choosing an input', () => {
  it('"counter\'s 0, 1, 0, 1 turns two sawtooths off and on every 300 ms"', async () => {
    const r = await runX('mc.selector~', 0, { seconds: 1.3, listen: [{ box: 'counter' }] });
    expect(firsts(r.heard.counter).slice(0, 4)).toEqual([0, 1, 0, 1]);
    expect(rms(r.left, 0.02, 0.28)).toBeLessThan(1e-3);
    expect(rms(r.left, 0.32, 0.58)).toBeGreaterThan(0.05);
    expect(rms(r.left, 0.62, 0.88)).toBeLessThan(1e-3);
    expect(rms(r.left, 0.92, 1.18)).toBeGreaterThan(0.05);
    expect(zcFreq(r.left, 0.32, 0.58)).toBeCloseTo(110, 0);
  });
});

describe('mc.send~/0: Sending two channels without a cord', () => {
  it('"sends a 2-channel signal to every mc.receive~ named \\"duet\\"": 294 Hz arrives', async () => {
    const r = await runX('mc.send~', 0, { seconds: 1 });
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(294, 0);
    expect(rms(r.left, 0.1, 0.9)).toBeCloseTo(0.2 / Math.SQRT2, 3);
  });
});

describe('mc.sig~/0: Constant signals, one per channel', () => {
  it('"220 and 277. Into mc.cycle~\'s left inlet they set each channel\'s frequency"', async () => {
    const r = await runX('mc.sig~', 0, { seconds: 1 });
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(220, 0);
    expect(12 * Math.log2(277 / 220)).toBeCloseTo(4, 0);                     // "a major third"
  });
});

describe('mc.snapshot~/0: Every channel, one after another', () => {
  // In Max both channels' values reach scale within each 125 ms and channel 2 wins; here
  // there is one channel, so the melody follows channel 1 (0.2 Hz).
  it('"samples each channel every 125 ms ... Both values reach scale" -> mtof -> cycle~', async () => {
    const r = await runX('mc.snapshot~', 0, { seconds: 2.2, listen: [{ box: 'mc.snapshot~' }, { box: 'mtof' }] });
    const h = r.heard['mc.snapshot~'];
    expect(h.length).toBeGreaterThanOrEqual(15);
    expect((h.at(-1)!.t - h[0].t) / (h.length - 1)).toBeCloseTo(0.125, 2);   // (the clock here steps 10 ms)
    for (const x of h) expect(Math.abs(x.msg[0] as number)).toBeLessThanOrEqual(1);
    for (let i = 1; i < h.length; i++) expect(Math.abs((h[i].msg[0] as number) - (h[i - 1].msg[0] as number))).toBeLessThan(2 * Math.PI * 0.2 * 0.14);
    const m = r.heard.mtof.filter((x) => x.t < 1.5).at(-1)!;
    expect(m.msg[0] as number).toBeCloseTo(mtof(66 + 6 * (h.filter((x) => x.t <= m.t).at(-1)!.msg[0] as number)), 0);
    expect(zcFreq(r.left, m.t + 0.02, m.t + 0.11)).toBeCloseTo(m.msg[0] as number, -0.5);
  });
  it.fails('BUG: "the channel number comes out the right outlet": the engine\'s mc.snapshot~ has no voice outlet', async () => {
    const r = await runX('mc.snapshot~', 0, { seconds: 0.6, listen: [{ box: 'mc.snapshot~', outlet: 1, label: 'voice' }, { box: 'number' }] });
    expect(firsts(r.heard.voice).slice(0, 3)).toEqual([1, 1, 1]);
    expect(r.heard.number.length).toBeGreaterThan(0);
  });
});

describe('mc.sqrt~/0: Ramps that rise fast', () => {
  it('"Two 0..1 ramps ... (1 ... Hz) bend into quick swells"', async () => {
    const r = await runX('mc.sqrt~', 0, { seconds: 1.2 });
    expect(env(r.left, 0.0625, 0.2)).toBeCloseTo(0.25, 1);
    expect(env(r.left, 0.25, 0.2)).toBeCloseTo(0.5, 1);
    expect(env(r.left, 0.64, 0.2)).toBeCloseTo(0.8, 1);
    expect(zcFreq(r.left, 0.3, 0.9)).toBeCloseTo(330, 0);
  });
});

describe('mc.svf~/0: Band-pass on every channel', () => {
  const gainAt = (x: Float32Array, t0: number, t1: number, k: number) => amp(x, t0, t1, 110 * k) / (0.2 * saw(k));
  it('"This plays the band-pass (outlet 2) of two sawtooths" around 1200 Hz', async () => {
    const r = await runX('mc.svf~', 0, { seconds: 1 });
    expect(gainAt(r.left, 0.2, 0.9, 11) / gainAt(r.left, 0.2, 0.9, 1)).toBeGreaterThan(5);
    expect(gainAt(r.left, 0.2, 0.9, 11) / gainAt(r.left, 0.2, 0.9, 40)).toBeGreaterThan(5);
  });
  it('"turn the dial to move the band from 300 to 3000 Hz"', async () => {
    const r = await runX('mc.svf~', 0, { seconds: 2.2, sends: [{ t: 0.1, box: 'dial', msg: [127] }] });
    expect(gainAt(r.left, 0.4, 2.1, 27) / gainAt(r.left, 0.4, 2.1, 11)).toBeGreaterThan(3);
  });
});

describe('mc.tapin~/0: Fading echoes on two channels', () => {
  it('"mc.tapout~ reads them 300 ms later. Feeding half the echo back" (checked on the engine\'s square input)', async () => {
    // y = x + 0.5·y(t - 0.3) with x = a for the first second: a, 1.5a, 1.75a, 1.875a by 300 ms steps
    const r = await runX('mc.tapin~', 0, { seconds: 1 });
    const a = mean(r.left, 0.02, 0.28);
    expect(a).toBeGreaterThan(0.1);
    expect(mean(r.left, 0.32, 0.58) / a).toBeCloseTo(1.5, 1);
    expect(mean(r.left, 0.62, 0.88) / a).toBeCloseTo(1.75, 1);
    expect(mean(r.left, 0.92, 0.99) / a).toBeCloseTo(1.875, 1);
  });
  it.fails('BUG: "each click track repeat[s], quieter each time": engine train~ is a ±1 square, so there are no clicks to echo', async () => {
    const r = await runX('mc.tapin~', 0, { seconds: 1.3 });
    const lvl = [0, 0.3, 0.6, 0.9].map((t) => rms(r.left, t + 0.003, t + 0.017));
    expect(lvl[0]).toBeCloseTo(0.2, 2);
    expect(lvl[1] / lvl[0]).toBeCloseTo(0.5, 1);
    expect(lvl[2] / lvl[1]).toBeCloseTo(0.5, 1);
    expect(lvl[3] / lvl[2]).toBeCloseTo(0.5, 1);
    expect(rms(r.left, 0.03, 0.29)).toBeLessThan(1e-3);
    expect(onsets(r.left, 0.01, 0.1).slice(0, 4).map((t) => Math.round(t * 1000))).toEqual([0, 300, 600, 900]);
  });
});

describe('mc.tapout~/0: Set the echo time', () => {
  it('"250 ms to start. Type a time from 1 to 1000 in the number box to move the echo" (on the engine\'s square)', async () => {
    // x is +a / -a for half a second each. Dry + 250 ms echo: a, 2a, 0, -2a by quarters;
    // with 500 ms the echo is exactly out of phase and the sum is silent.
    const r = await runX('mc.tapout~', 0, { seconds: 2.7, sends: [{ t: 1.05, box: 'number', msg: [500] }] });
    const a = mean(r.left, 0.02, 0.23);
    expect(a).toBeGreaterThan(0.1);
    expect(mean(r.left, 0.27, 0.48) / a).toBeCloseTo(2, 1);
    expect(mean(r.left, 0.52, 0.73) / a).toBeCloseTo(0, 1);
    expect(mean(r.left, 0.77, 0.98) / a).toBeCloseTo(-2, 1);
    expect(rms(r.left, 1.6, 2.65) / a).toBeLessThan(0.05);
  });
  it.fails('BUG: "move the echo of both click tracks": engine train~ is a ±1 square, not clicks', async () => {
    const r = await runX('mc.tapout~', 0, { seconds: 2.7, sends: [{ t: 1.5, box: 'number', msg: [500] }] });
    const on = onsets(r.left, 0.05, 0.1).map((t) => Math.round(t * 1000));
    expect(on.slice(0, 4)).toEqual([0, 250, 1000, 1250]);
    expect(on.slice(4)).toEqual([2000, 2500]);
  });
});

describe('mc.teeth~/0: A comb with two delays', () => {
  it('"only the 2 ms feedback is used (gain 0.9), so two noise streams ring near 500 Hz"', async () => {
    const r = await runX('mc.teeth~', 0, { seconds: 1.5 });
    expect(pitch(r.left, 0.3, 1.4)).toBeCloseTo(500, -1);
    expect(rms(r.left, 0.3, 1.4)).toBeCloseTo((0.5 / Math.sqrt(3) / Math.sqrt(1 - 0.81)) * 0.05, 2);
  });
});

describe('mc.thresh~/0: Rhythms from slow waves', () => {
  it('"Two slow sines (1 ... Hz) become on/off gates": one pulse a second on the left', async () => {
    const r = await runX('mc.thresh~', 0, { seconds: 2.1 });
    expect(env(r.left, 0.1, 0.2)).toBeGreaterThan(0.95);
    expect(env(r.left, 0.5, 0.2)).toBeLessThan(0.01);
    expect(env(r.left, 1.1, 0.2)).toBeGreaterThan(0.95);
    expect(zcFreq(r.left, 0.02, 0.18)).toBeCloseTo(523, 0);
  });
  // cos 1 Hz: above 0.5 at 5/6 s (on), below 0 at 1/4 s (off): on [0, .25] and [.833, 1.25]
  // Max: 1 when the input rises above 0.5, 0 when it falls below 0. Whatever the LFO's start
  // phase (Max: cosine; engine: sine), the gate opens where it crosses 0.5 going up (5/6 s for a
  // cosine, 1/12 s for a sine) and closes where it crosses 0 going down (1/4 s, or 1/2 s).
  it.fails('BUG: "1 once a channel rises above 0.5, and 0 again once it falls below 0": engine thresh~ has no hysteresis (one trip point at 0.25)', async () => {
    const r = await runX('mc.thresh~', 0, { seconds: 2.1 });
    const blocks = (on: boolean) => {
      const out: number[] = []; let prev = !on;
      for (let t = 0; t < 2; t += 0.001) { const now = rms(r.left, t, t + 0.002) > 1e-3; if (now === on && prev !== on && t > 0.005) out.push(t); prev = now; }
      return out;
    };
    const opens = blocks(true), closes = blocks(false);
    console.log('EVIDENCE mc.thresh~ gate opens at', opens.map((t) => t.toFixed(3)), 'closes at', closes.map((t) => t.toFixed(3)));
    const near = (t: number, ...xs: number[]) => xs.some((x) => Math.abs(t - x) < 0.01);
    expect(near(opens[0], 5 / 6, 1 / 12)).toBe(true);
    expect(near(closes[0], 0.25, 0.5)).toBe(true);
  });
});

describe('mc.times~/0: Turning every channel down at once', () => {
  it('"two sines, 220 Hz on the left ... both turned down to 0.2"', async () => {
    const r = await runX('mc.times~', 0, { seconds: 1 });
    expect(zcFreq(r.left, 0.1, 0.9)).toBeCloseTo(220, 0);
    expect(peak(r.left, 0.1, 0.9)).toBeCloseTo(0.2, 3);
  });
});

describe('mc.train~/0: Two click tracks at once', () => {
  // train~ ref: pulse width 0..1 (default 0.5), a 0/1 pulse. Engine osc.ts: OscillatorNode 'square'
  // (±1, peak-normalised to ±0.85, width ignored).
  it.fails('BUG: "Periods of 250 ... ms put four clicks a second": engine train~ is a ±1 square wave, pulse width ignored', async () => {
    const r = await runX('mc.train~', 0, { seconds: 2.05 });
    console.log('EVIDENCE mc.train~ samples every 50 ms', Array.from({ length: 10 }, (_, i) => r.left[Math.round((0.01 + i * 0.05) * SR)].toFixed(3)).join(' '));
    const on = onsets(r.left, 0.1, 0.1).map((t) => Math.round(t * 1000));
    expect(on).toEqual([0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000]);
    expect(rms(r.left, 0.0005, 0.0045)).toBeCloseTo(0.2, 3);                 // 5 ms clicks (width 0.02)
    expect(rms(r.left, 0.006, 0.24)).toBeLessThan(1e-4);
  });
});

describe('mc.trapezoid~/0: Envelopes from a wavetable', () => {
  it('"up by 0.1, flat until 0.5, then down. Fed by two ramps (1 ... Hz)"', async () => {
    const r = await runX('mc.trapezoid~', 0, { seconds: 1.2 });
    expect(env(r.left, 0.05, 0.2)).toBeCloseTo(0.5, 1);
    expect(env(r.left, 0.3, 0.2)).toBeCloseTo(1, 1);
    expect(env(r.left, 0.75, 0.2)).toBeCloseTo(0.5, 1);
    expect(env(r.left, 0.98, 0.2)).toBeLessThan(0.1);
    expect(zcFreq(r.left, 0.2, 0.45)).toBeCloseTo(392, 0);
  });
});

describe('mc.tri~/0: A number goes to every channel', () => {
  it('"starts as two triangle waves, 262 ... type a frequency in the number box and both voices jump to it"', async () => {
    const r = await runX('mc.tri~', 0, { seconds: 1.2, sends: [{ t: 0.6, box: 'number', msg: [440] }] });
    expect(zcFreq(r.left, 0.1, 0.55)).toBeCloseTo(262, 0);
    expect(zcFreq(r.left, 0.7, 1.15)).toBeCloseTo(440, 0);
  });
});
