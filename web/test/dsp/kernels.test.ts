// Golden-vector kernel tests — the PRIMARY correctness layer for the worklet DSP.
// These assert REAL DSP behaviour on Float32 blocks in pure Node (no browser, no
// worklet): band energy of a filter, step responses, impulse echoes, accumulation,
// slew/slope bounds. The worklet processors mirror this same math.

import { describe, expect, it } from 'vitest';
import {
  biquadProcess, makeBiquadState, lowpassCoeffs,
  onepoleProcess, makeOnePoleState, onepoleCoef,
  svfProcess, makeSVFState, svfF, svfQ, svfDamping,
  combProcess, makeCombState,
  allpassProcess, makeAllpassState,
  accumProcess, makeAccumState,
  rampsmoothProcess, makeRampSmoothState,
  deltaclipProcess, makeDeltaClipState,
  degradeProcess, makeDegradeState,
  overdrive, fold, wrap,
} from '../../src/dsp/kernels';

const SR = 44100;

// ── tiny signal helpers ───────────────────────────────────────────────────────────

// Deterministic white noise in [-1, 1] via a linear congruential generator.
function whiteNoise(n: number, seed = 12345): Float32Array {
  const x = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (1103515245 * s + 12345) >>> 0;
    x[i] = (s / 0xffffffff) * 2 - 1;
  }
  return x;
}

function sine(n: number, freq: number, sr = SR): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

function energy(x: Float32Array): number {
  let e = 0;
  for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  return e;
}

// Energy in the frequency band [f0, f1] via a direct DFT (O(N*bins), fine for tests).
function bandEnergy(x: Float32Array, f0: number, f1: number, sr = SR): number {
  const N = x.length;
  const k0 = Math.max(1, Math.floor((f0 * N) / sr));
  const k1 = Math.min(N / 2 - 1, Math.ceil((f1 * N) / sr));
  let total = 0;
  for (let k = k0; k <= k1; k++) {
    let re = 0, im = 0;
    const w = (-2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) {
      re += x[n] * Math.cos(w * n);
      im += x[n] * Math.sin(w * n);
    }
    total += re * re + im * im;
  }
  return total;
}

// ── biquad~ ────────────────────────────────────────────────────────────────────────
describe('biquadProcess', () => {
  it('unity passthrough when a0=1 and the rest are 0', () => {
    const x = whiteNoise(256);
    const y = biquadProcess(x, { a0: 1, a1: 0, a2: 0, b1: 0, b2: 0 }, makeBiquadState());
    for (let i = 0; i < x.length; i++) expect(y[i]).toBeCloseTo(x[i], 6);
  });

  it('lowpass drops far more high-band than low-band energy', () => {
    const N = 2048;
    const x = whiteNoise(N);
    const c = lowpassCoeffs(1000, 0.707, SR);
    const y = biquadProcess(x, c, makeBiquadState());
    // Low band (100–500 Hz) passes; high band (8k–16k) is attenuated.
    const lowRatio = bandEnergy(y, 100, 500) / bandEnergy(x, 100, 500);
    const highRatio = bandEnergy(y, 8000, 16000) / bandEnergy(x, 8000, 16000);
    expect(lowRatio).toBeGreaterThan(0.5); // passband roughly preserved
    expect(highRatio).toBeLessThan(0.02); // stopband strongly cut
    expect(highRatio).toBeLessThan(lowRatio * 0.05);
  });

  it('carries state across blocks (split == whole)', () => {
    const x = whiteNoise(512);
    const c = lowpassCoeffs(2000, 1, SR);
    const whole = biquadProcess(x, c, makeBiquadState());
    const s = makeBiquadState();
    const a = biquadProcess(x.slice(0, 256), c, s);
    const b = biquadProcess(x.slice(256), c, s);
    for (let i = 0; i < 256; i++) expect(a[i]).toBeCloseTo(whole[i], 5);
    for (let i = 0; i < 256; i++) expect(b[i]).toBeCloseTo(whole[256 + i], 5);
  });
});

// ── onepole~ ─────────────────────────────────────────────────────────────────────
describe('onepoleProcess', () => {
  it('step response monotonically approaches the target without overshoot', () => {
    const x = new Float32Array(2000).fill(1);
    const g = onepoleCoef(200, SR);
    const y = onepoleProcess(x, g, makeOnePoleState());
    for (let i = 1; i < y.length; i++) {
      expect(y[i]).toBeGreaterThanOrEqual(y[i - 1] - 1e-9); // monotone up
      expect(y[i]).toBeLessThanOrEqual(1 + 1e-6); // no overshoot past target
    }
    expect(y[y.length - 1]).toBeGreaterThan(0.99); // reaches the target
    expect(y[0]).toBeLessThan(0.5); // and doesn't jump there instantly
  });

  it('onepoleCoef stays within (0,1) and rises with cutoff', () => {
    expect(onepoleCoef(100, SR)).toBeGreaterThan(0);
    expect(onepoleCoef(100, SR)).toBeLessThan(onepoleCoef(5000, SR));
    expect(onepoleCoef(1e9, SR)).toBeLessThanOrEqual(1);
  });
});

// ── svf~ ─────────────────────────────────────────────────────────────────────────
describe('svfProcess', () => {
  it('lowpass passes a low tone and rejects a high tone', () => {
    const f = svfF(800, SR), q = svfQ(1);
    const lowIn = sine(4096, 200);
    const highIn = sine(4096, 8000);
    const low = svfProcess(lowIn, f, q, makeSVFState()).lp;
    const high = svfProcess(highIn, f, q, makeSVFState()).lp;
    // The 8 kHz tone is far more attenuated than the 200 Hz tone.
    expect(energy(high) / energy(highIn)).toBeLessThan(0.1);
    expect(energy(low) / energy(lowIn)).toBeGreaterThan(energy(high) / energy(highIn) * 5);
  });

  it('highpass does the opposite of lowpass', () => {
    const f = svfF(800, SR), q = svfQ(1);
    const highIn = sine(4096, 8000);
    const hp = svfProcess(highIn, f, q, makeSVFState()).hp;
    const lp = svfProcess(highIn, f, q, makeSVFState()).lp;
    expect(energy(hp)).toBeGreaterThan(energy(lp));
  });
});

// The numbers below were read off Max 9 itself: test signals rendered through the real
// objects and recorded. They are here so the browser engine cannot drift away from Max.
describe('svf~ as measured in Max', () => {
  it('damping follows (1.2 * (1 - resonance))^2, capped at 1', () => {
    // gain at the cutoff, measured: 1.41 at 0.3, 2.77 at 0.5, 7.7 at 0.7, 66.8 at 0.9
    expect(1 / svfDamping(0.3)).toBeCloseTo(1.417, 2);
    expect(1 / svfDamping(0.5)).toBeCloseTo(2.778, 2);
    expect(1 / svfDamping(0.7)).toBeCloseTo(7.716, 2);
    expect(1 / svfDamping(0.9)).toBeCloseTo(69.44, 1);
    expect(svfDamping(0)).toBe(1);
    expect(svfDamping(0.1)).toBe(1);
    expect(svfDamping(1)).toBeGreaterThan(0); // never quite self-oscillating
  });

  it('the frequency coefficient is sin(2*pi*fc/sr) and stops at a quarter of the sample rate', () => {
    expect(svfF(1000, SR)).toBeCloseTo(Math.sin((2 * Math.PI * 1000) / SR), 12);
    expect(svfF(SR / 4, SR)).toBeCloseTo(1, 12);
    expect(svfF(20000, SR)).toBeCloseTo(1, 12);
  });

  it('a tone at the cutoff comes out of the lowpass louder by the quality factor', () => {
    const x = sine(44100, 1000);
    const lp = svfProcess(x, svfF(1000, SR), svfDamping(0.5), makeSVFState()).lp;
    const tail = (v: Float32Array) => energy(v.subarray(22050));
    expect(Math.sqrt(tail(lp) / tail(x))).toBeCloseTo(2.78, 1);
  });
});

describe('waveshapers as measured in Max', () => {
  it('overdrive~ is 1 - (1 - |x|)^drive', () => {
    // a ramp through overdrive~ at drive 2: 0.2 -> 0.36, 0.4 -> 0.64, 0.6 -> 0.84
    expect(overdrive(0.2, 2)).toBeCloseTo(0.36, 6);
    expect(overdrive(0.4, 2)).toBeCloseTo(0.64, 6);
    expect(overdrive(-0.6, 2)).toBeCloseTo(-0.84, 6);
    expect(overdrive(0.2, 3)).toBeCloseTo(0.488, 6);
    expect(overdrive(0.2, 1.5)).toBeCloseTo(0.284, 3);
    expect(overdrive(0.37, 1)).toBeCloseTo(0.37, 6); // drive 1 is a straight line
    expect(overdrive(1.7, 5)).toBe(1); // flat past full scale
    expect(overdrive(-1.7, 5)).toBe(-1);
  });

  it('pong~ mode 0 folds the signal back at the limits', () => {
    // a ramp times 3 through pong~ 0 -1. 1.: 1.2 -> 0.8, 1.8 -> 0.2, 2.4 -> -0.4, 2.85 -> -0.85
    expect(fold(1.2, -1, 1)).toBeCloseTo(0.8, 6);
    expect(fold(1.8, -1, 1)).toBeCloseTo(0.2, 6);
    expect(fold(2.4, -1, 1)).toBeCloseTo(-0.4, 6);
    expect(fold(-2.85, -1, 1)).toBeCloseTo(0.85, 6);
    expect(fold(0.3, -1, 1)).toBeCloseTo(0.3, 6);
    for (const x of [-37.2, -4, 5.5, 91]) expect(Math.abs(fold(x, -1, 1))).toBeLessThanOrEqual(1);
  });

  it('pong~ mode 1 wraps round to the other limit', () => {
    expect(wrap(1.25, -1, 1)).toBeCloseTo(-0.75, 6);
    expect(wrap(-1.5, -1, 1)).toBeCloseTo(0.5, 6);
    expect(wrap(0.3, -1, 1)).toBeCloseTo(0.3, 6);
  });
});

// ── comb~ ────────────────────────────────────────────────────────────────────────
describe('combProcess', () => {
  it('feedback comb produces decaying echoes at the delay length', () => {
    const N = 512, D = 100;
    const x = new Float32Array(N); x[0] = 1; // impulse
    const y = combProcess(x, { delay: D, a: 1, b: 0, c: 0.5 }, makeCombState(D + 1));
    expect(y[0]).toBeCloseTo(1, 6);
    expect(y[D]).toBeCloseTo(0.5, 6);
    expect(y[2 * D]).toBeCloseTo(0.25, 6);
    // No echo between taps.
    expect(y[D - 1]).toBeCloseTo(0, 6);
    expect(y[D + 1]).toBeCloseTo(0, 6);
  });

  it('feedforward comb yields a single delayed copy', () => {
    const N = 400, D = 80;
    const x = new Float32Array(N); x[0] = 1;
    const y = combProcess(x, { delay: D, a: 1, b: 0.7, c: 0 }, makeCombState(D + 1));
    expect(y[0]).toBeCloseTo(1, 6);
    expect(y[D]).toBeCloseTo(0.7, 6);
    expect(y[2 * D]).toBeCloseTo(0, 6); // no feedback -> nothing at 2D
  });
});

// ── allpass~ ─────────────────────────────────────────────────────────────────────
describe('allpassProcess', () => {
  it('has a flat magnitude response (preserves signal energy)', () => {
    const N = 4096, D = 53;
    const x = whiteNoise(N);
    const s = makeAllpassState(D + 1);
    const y = allpassProcess(x, { delay: D, g: 0.5 }, s);
    // Flush the tail with zeros so the full response energy is counted.
    const tail = allpassProcess(new Float32Array(2048), { delay: D, g: 0.5 }, s);
    const eOut = energy(y) + energy(tail);
    const eIn = energy(x);
    expect(eOut / eIn).toBeGreaterThan(0.95);
    expect(eOut / eIn).toBeLessThan(1.05);
  });

  it('impulse response is non-trivial (a real filter, not passthrough)', () => {
    const N = 300, D = 40;
    const x = new Float32Array(N); x[0] = 1;
    const y = allpassProcess(x, { delay: D, g: 0.5 }, makeAllpassState(D + 1));
    expect(y[0]).toBeCloseTo(-0.5, 6); // -g at n=0
    expect(y[D]).toBeCloseTo(1 + 0.5 * -0.5, 6); // x[n-D] + g*y[n-D] = 1 + 0.5*(-0.5)
  });
});

// ── +=~ ──────────────────────────────────────────────────────────────────────────
describe('accumProcess', () => {
  it('accumulates a running sum of the input', () => {
    const x = new Float32Array(10).fill(1);
    const y = accumProcess(x, makeAccumState());
    for (let i = 0; i < 10; i++) expect(y[i]).toBe(i + 1);
  });

  it('honours the initial sum and carries across blocks', () => {
    const s = makeAccumState(100);
    const a = accumProcess(new Float32Array([1, 2, 3]), s);
    expect(Array.from(a)).toEqual([101, 103, 106]);
    const b = accumProcess(new Float32Array([4]), s);
    expect(b[0]).toBe(110);
  });
});

// ── rampsmooth~ ──────────────────────────────────────────────────────────────────
describe('rampsmoothProcess', () => {
  it('slews to a step over `up` samples at a bounded rate', () => {
    const up = 10;
    const x = new Float32Array(50).fill(1);
    const y = rampsmoothProcess(x, { up, down: up }, makeRampSmoothState());
    expect(y[0]).toBeCloseTo(0.1, 6); // 1/up per sample
    expect(y[up - 1]).toBeCloseTo(1, 6); // reaches target after `up` samples
    for (let i = 1; i < y.length; i++) expect(Math.abs(y[i] - y[i - 1])).toBeLessThanOrEqual(1 / up + 1e-6);
  });

  it('uses the down rate when falling', () => {
    const s = makeRampSmoothState();
    rampsmoothProcess(new Float32Array(20).fill(1), { up: 5, down: 20 }, s); // settle at 1
    const y = rampsmoothProcess(new Float32Array(40).fill(0), { up: 5, down: 20 }, s);
    for (let i = 1; i < y.length; i++) expect(Math.abs(y[i] - y[i - 1])).toBeLessThanOrEqual(1 / 20 + 1e-6);
    expect(y[19]).toBeCloseTo(0, 6); // fully down after `down` samples
  });
});

// ── deltaclip~ ───────────────────────────────────────────────────────────────────
describe('deltaclipProcess', () => {
  it('bounds the sample-to-sample delta to [lo, hi]', () => {
    const x = new Float32Array(20).fill(10); // hard step from 0
    const y = deltaclipProcess(x, { lo: -1, hi: 1 }, makeDeltaClipState());
    for (let i = 0; i < y.length; i++) {
      const prev = i === 0 ? 0 : y[i - 1];
      expect(y[i] - prev).toBeLessThanOrEqual(1 + 1e-9);
      expect(y[i] - prev).toBeGreaterThanOrEqual(-1 - 1e-9);
    }
    expect(y[0]).toBeCloseTo(1, 6); // rose by exactly hi
    expect(y[9]).toBeCloseTo(10, 6); // reached target after 10 steps of +1
  });

  it('clips a fast downward slope', () => {
    const s = makeDeltaClipState(5);
    const y = deltaclipProcess(new Float32Array(10).fill(-5), { lo: -0.5, hi: 0.5 }, s);
    for (let i = 1; i < y.length; i++) expect(y[i - 1] - y[i]).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});

// ── degrade~ ─────────────────────────────────────────────────────────────────────
describe('degradeProcess', () => {
  it('sample-rate reduction holds values (fewer transitions than samples)', () => {
    const x = whiteNoise(400);
    const full = degradeProcess(x, { ratio: 1, bits: 24 }, makeDegradeState());
    const half = degradeProcess(x, { ratio: 0.5, bits: 24 }, makeDegradeState());
    const transitions = (v: Float32Array) => { let t = 0; for (let i = 1; i < v.length; i++) if (v[i] !== v[i - 1]) t++; return t; };
    // Downsampling by ~2 roughly halves the number of value changes.
    expect(transitions(half)).toBeLessThan(transitions(full) * 0.75);
  });

  it('rounds down, as Max does, so 4 bits puts 0.1 at 0 and -0.1 at -0.125', () => {
    const x = Float32Array.from([0.1, -0.1, 0.124, 0.126, -0.7, 0.7]);
    const y = degradeProcess(x, { ratio: 1, bits: 4 }, makeDegradeState());
    expect(Array.from(y)).toEqual([0, -0.125, 0, 0.125, -0.75, 0.625]);
  });

  it('at a ratio of 0.1 every tenth sample is taken and held for ten', () => {
    const x = Float32Array.from({ length: 40 }, (_, i) => i / 64);
    const y = degradeProcess(x, { ratio: 0.1, bits: 24 }, makeDegradeState());
    expect(y[0]).toBeCloseTo(0, 6);
    for (let i = 1; i < 10; i++) expect(y[i]).toBe(y[0]);
    expect(y[10]).not.toBe(y[9]);
  });

  it('bit reduction limits the number of distinct output levels', () => {
    const x = sine(1000, 220);
    const lo = degradeProcess(x, { ratio: 1, bits: 2 }, makeDegradeState());
    const distinct = new Set(Array.from(lo)).size;
    expect(distinct).toBeLessThanOrEqual(Math.pow(2, 2) + 1);
  });
});
