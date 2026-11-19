// Pure DSP kernels — the source of correctness for the AudioWorklet-backed MSP
// objects. Every function here is a plain operation on Float32 sample blocks with an
// explicit, mutable `state` object carried across blocks. No Web Audio, no worklet,
// no browser — so they run and are unit-tested directly in Node (see test/dsp/).
//
// The AudioWorklet processors in `runtime/worklet.ts` re-implement THE SAME math
// (they run in a separate global scope and cannot import this module), so the two
// must be kept in sync. These functions are the reference; the processors mirror them.
//
// Convention: each kernel reads an input block `x`, writes an output block (returned
// as a fresh Float32Array unless noted), and mutates `state` in place so that calling
// it again on the next block continues seamlessly.

// ── biquad~ : direct-form-I biquad with 5 mutable coefficients ────────────────────
// Max's biquad~ convention (note the SIGN of the feedback terms):
//   y[n] = a0*x[n] + a1*x[n-1] + a2*x[n-2] - b1*y[n-1] - b2*y[n-2]
export interface BiquadCoeffs { a0: number; a1: number; a2: number; b1: number; b2: number; }
export interface BiquadState { x1: number; x2: number; y1: number; y2: number; }

export function makeBiquadState(): BiquadState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

export function biquadProcess(x: Float32Array, c: BiquadCoeffs, s: BiquadState): Float32Array {
  const out = new Float32Array(x.length);
  let { x1, x2, y1, y2 } = s;
  for (let i = 0; i < x.length; i++) {
    const xn = x[i];
    const yn = c.a0 * xn + c.a1 * x1 + c.a2 * x2 - c.b1 * y1 - c.b2 * y2;
    x2 = x1; x1 = xn;
    y2 = y1; y1 = yn;
    out[i] = yn;
  }
  s.x1 = x1; s.x2 = x2; s.y1 = y1; s.y2 = y2;
  return out;
}

/**
 * Robert Bristow-Johnson lowpass biquad design, normalised into Max's a/b layout
 * (a = feedforward, b = feedback, a0 already divided out). Handy for building test
 * vectors and for a musically-useful default before the user pushes their own coeffs.
 */
export function lowpassCoeffs(freqHz: number, q: number, sr: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * freqHz) / sr;
  const cw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(1e-4, q));
  const b0 = (1 - cw) / 2;
  const b1 = 1 - cw;
  const b2 = (1 - cw) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cw;
  const a2 = 1 - alpha;
  return { a0: b0 / a0, a1: b1 / a0, a2: b2 / a0, b1: a1 / a0, b2: a2 / a0 };
}

// ── onepole~ : one-pole lowpass ───────────────────────────────────────────────────
//   y[n] = y[n-1] + g*(x[n] - y[n-1]),  g = 1 - exp(-2*pi*fc/sr)
// A leaky integrator: a step input approaches its target monotonically (no overshoot).
export interface OnePoleState { y1: number; }
export function makeOnePoleState(): OnePoleState { return { y1: 0 }; }

/** Cutoff frequency (Hz) -> the one-pole smoothing coefficient g in (0,1). */
export function onepoleCoef(freqHz: number, sr: number): number {
  const g = 1 - Math.exp((-2 * Math.PI * Math.max(0, freqHz)) / sr);
  return Math.min(1, Math.max(0, g));
}

export function onepoleProcess(x: Float32Array, g: number, s: OnePoleState): Float32Array {
  const out = new Float32Array(x.length);
  let y1 = s.y1;
  for (let i = 0; i < x.length; i++) {
    y1 = y1 + g * (x[i] - y1);
    out[i] = y1;
  }
  s.y1 = y1;
  return out;
}

// ── svf~ : Chamberlin state-variable filter (4 simultaneous outputs) ───────────────
// Produces lowpass, highpass, bandpass and notch from one input. `f` maps the cutoff
// and `q` is the damping (= 1/Q). Stable for f < ~1.0 and q in (0,2].
export interface SVFState { low: number; band: number; }
export interface SVFOut { lp: Float32Array; hp: Float32Array; bp: Float32Array; notch: Float32Array; }
export function makeSVFState(): SVFState { return { low: 0, band: 0 }; }

/**
 * Cutoff (Hz) -> the `f` coefficient. Max uses sin(2*pi*fc/sr) and stops at a quarter of
 * the sample rate, where it reaches 1. (The textbook 2*sin(pi*fc/sr) agrees at low
 * cutoffs and drifts apart near the top.)
 */
export function svfF(freqHz: number, sr: number): number {
  return Math.sin((2 * Math.PI * Math.max(0, Math.min(freqHz, sr / 4))) / sr);
}
/** Resonance (>= ~0.5) -> the damping `q` (= 1/Q); higher resonance -> lower damping. */
export function svfQ(resonance: number): number {
  return 1 / Math.max(0.5, resonance);
}
/**
 * Max's svf~ resonance (0..1) -> the damping `q`. Measured in Max 9 from the gain at the
 * cutoff over eleven settings: q = (1.2 * (1 - resonance))^2, capped at 1. So anything up
 * to about 0.17 is flat, 0.5 is a Q of 2.8, and 0.9 is a Q of 67, close to ringing forever.
 */
export function svfDamping(resonance01: number): number {
  const d = 1.2 * (1 - Math.min(1, Math.max(0, resonance01)));
  return Math.max(0.0001, Math.min(1, d * d));
}

export function svfProcess(x: Float32Array, f: number, q: number, s: SVFState): SVFOut {
  const n = x.length;
  const lp = new Float32Array(n);
  const hp = new Float32Array(n);
  const bp = new Float32Array(n);
  const notch = new Float32Array(n);
  let low = s.low, band = s.band;
  for (let i = 0; i < n; i++) {
    low += f * band;
    const high = x[i] - low - q * band;
    band += f * high;
    lp[i] = low; hp[i] = high; bp[i] = band; notch[i] = high + low;
  }
  s.low = low; s.band = band;
  return { lp, hp, bp, notch };
}

// ── comb~ : feedforward + feedback comb filter ────────────────────────────────────
//   y[n] = a*x[n] + b*x[n-D] + c*y[n-D]
// Two ring buffers hold the delayed x and y histories. An impulse re-appears every D
// samples (the "comb" echoes), scaled by c^k on the feedback path.
export interface CombParams { delay: number; a: number; b: number; c: number; }
export interface CombState { xbuf: Float32Array; ybuf: Float32Array; write: number; }
export function makeCombState(maxDelay: number): CombState {
  const size = Math.max(1, Math.floor(maxDelay));
  return { xbuf: new Float32Array(size), ybuf: new Float32Array(size), write: 0 };
}

export function combProcess(x: Float32Array, p: CombParams, s: CombState): Float32Array {
  const out = new Float32Array(x.length);
  const size = s.xbuf.length;
  const D = Math.max(1, Math.min(size, Math.floor(p.delay)));
  let write = s.write;
  for (let i = 0; i < x.length; i++) {
    const read = (write - D + size) % size;
    const xd = s.xbuf[read];
    const yd = s.ybuf[read];
    const yn = p.a * x[i] + p.b * xd + p.c * yd;
    s.xbuf[write] = x[i];
    s.ybuf[write] = yn;
    out[i] = yn;
    write = (write + 1) % size;
  }
  s.write = write;
  return out;
}

// ── allpass~ : delaying allpass filter (flat magnitude response) ───────────────────
//   y[n] = -g*x[n] + x[n-D] + g*y[n-D]
// |H(e^jw)| = 1 for all w, so total signal energy is preserved; only phase is altered.
export interface AllpassParams { delay: number; g: number; }
export interface AllpassState { xbuf: Float32Array; ybuf: Float32Array; write: number; }
export function makeAllpassState(maxDelay: number): AllpassState {
  const size = Math.max(1, Math.floor(maxDelay));
  return { xbuf: new Float32Array(size), ybuf: new Float32Array(size), write: 0 };
}

export function allpassProcess(x: Float32Array, p: AllpassParams, s: AllpassState): Float32Array {
  const out = new Float32Array(x.length);
  const size = s.xbuf.length;
  const D = Math.max(1, Math.min(size, Math.floor(p.delay)));
  const g = p.g;
  let write = s.write;
  for (let i = 0; i < x.length; i++) {
    const read = (write - D + size) % size;
    const xd = s.xbuf[read];
    const yd = s.ybuf[read];
    const yn = -g * x[i] + xd + g * yd;
    s.xbuf[write] = x[i];
    s.ybuf[write] = yn;
    out[i] = yn;
    write = (write + 1) % size;
  }
  s.write = write;
  return out;
}

// ── +=~ : running accumulator ─────────────────────────────────────────────────────
//   y[n] = y[n-1] + x[n]   (with an initial sum, resettable via state.sum)
export interface AccumState { sum: number; }
export function makeAccumState(initial = 0): AccumState { return { sum: initial }; }

export function accumProcess(x: Float32Array, s: AccumState): Float32Array {
  const out = new Float32Array(x.length);
  let sum = s.sum;
  for (let i = 0; i < x.length; i++) {
    sum += x[i];
    out[i] = sum;
  }
  s.sum = sum;
  return out;
}

// ── rampsmooth~ : linear slew limiter ─────────────────────────────────────────────
// When the input changes, ramp LINEARLY to the new value over `up` samples (rising) or
// `down` samples (falling). Guarantees |y[n] - y[n-1]| <= step, so it de-zippers
// control signals. A step of size Δ up over N samples has per-sample slope Δ/N.
export interface RampSmoothParams { up: number; down: number; }
export interface RampSmoothState { y: number; target: number; delta: number; remaining: number; }
export function makeRampSmoothState(): RampSmoothState {
  return { y: 0, target: 0, delta: 0, remaining: 0 };
}

export function rampsmoothProcess(x: Float32Array, p: RampSmoothParams, s: RampSmoothState): Float32Array {
  const out = new Float32Array(x.length);
  let { y, target, delta, remaining } = s;
  const up = Math.max(1, Math.floor(p.up));
  const down = Math.max(1, Math.floor(p.down));
  for (let i = 0; i < x.length; i++) {
    const xn = x[i];
    if (xn !== target) {
      target = xn;
      const n = xn > y ? up : down;
      remaining = n;
      delta = (xn - y) / n;
    }
    if (remaining > 0) {
      y += delta;
      remaining--;
      if (remaining === 0) y = target;
    }
    out[i] = y;
  }
  s.y = y; s.target = target; s.delta = delta; s.remaining = remaining;
  return out;
}

// ── deltaclip~ : slope (delta) limiter ────────────────────────────────────────────
// Bounds the sample-to-sample difference to [lo, hi]. Unlike rampsmooth~ (which ramps
// to a target over a fixed number of samples) this clips the instantaneous slope, so
// it hard-limits how fast the signal can move.
export interface DeltaClipParams { lo: number; hi: number; }
export interface DeltaClipState { y1: number; }
export function makeDeltaClipState(initial = 0): DeltaClipState { return { y1: initial }; }

export function deltaclipProcess(x: Float32Array, p: DeltaClipParams, s: DeltaClipState): Float32Array {
  const out = new Float32Array(x.length);
  let y1 = s.y1;
  const lo = Math.min(p.lo, p.hi);
  const hi = Math.max(p.lo, p.hi);
  for (let i = 0; i < x.length; i++) {
    let d = x[i] - y1;
    if (d > hi) d = hi;
    else if (d < lo) d = lo;
    y1 = y1 + d;
    out[i] = y1;
  }
  s.y1 = y1;
  return out;
}

// ── degrade~ : sample-rate reduction + bit-depth quantisation ──────────────────────
// Sample-and-hold at a reduced rate (`ratio` in (0,1], 1 = no reduction) plus
// quantisation to `bits` of amplitude resolution. Output is piecewise-constant with
// runs of length ~1/ratio and takes at most 2^bits distinct levels.
export interface DegradeParams { ratio: number; bits: number; }
export interface DegradeState { phase: number; hold: number; }
export function makeDegradeState(): DegradeState { return { phase: 1, hold: 0 }; }

// Max rounds down, not to nearest (measured against Max 9: at 4 bits every input in
// [0, 0.125) comes out 0 and every input in [-0.125, 0) comes out -0.125). That is why a
// crushed signal sits half a step below centre.
function quantize(v: number, bits: number): number {
  const b = Number.isFinite(bits) && bits >= 1 ? Math.floor(bits) : 1;
  const levels = Math.pow(2, b);
  const half = levels / 2;
  return Math.floor(v * half) / half;
}

export function degradeProcess(x: Float32Array, p: DegradeParams, s: DegradeState): Float32Array {
  const out = new Float32Array(x.length);
  // Single precision, like Max: ten steps of 0.1 then reach 1 and the hold is exactly ten
  // samples long. In double precision they stop a hair short and every other hold is eleven.
  const ratio = Math.fround(Math.min(1, Math.max(1e-6, p.ratio)));
  let phase = s.phase, hold = s.hold;
  for (let i = 0; i < x.length; i++) {
    // Take a new sample first, then advance: the order that lands the holds on the same
    // samples as Max.
    if (phase >= 1) {
      phase = Math.fround(phase - 1);
      hold = quantize(x[i], p.bits);
    }
    phase = Math.fround(phase + ratio);
    out[i] = hold;
  }
  s.phase = phase; s.hold = hold;
  return out;
}

// ── waveshapers: overdrive~, tanh~, pong~ ─────────────────────────────────────────
// Memoryless curves, one output sample per input sample. Max does not oversample any of
// these, so neither do we: the aliasing a hard fold makes is part of its sound.

/**
 * overdrive~. Measured against Max 9 with a ramp: y = sign(x) * (1 - (1 - |x|) ^ drive),
 * and anything past full scale stays at full scale. Drive 1 is a straight line.
 */
export function overdrive(x: number, drive: number): number {
  const a = Math.min(1, Math.abs(x));
  const y = 1 - Math.pow(1 - a, Math.max(0, drive));
  return x < 0 ? -y : y;
}

/** pong~ mode 0: reflect the signal back at `lo` and `hi`, as many times as it takes. */
export function fold(x: number, lo: number, hi: number): number {
  const range = hi - lo;
  if (!(range > 0)) return lo;
  let t = (x - lo) % (2 * range);
  if (t < 0) t += 2 * range;
  return lo + (t <= range ? t : 2 * range - t);
}

/** pong~ mode 1: wrap around from one limit to the other. */
export function wrap(x: number, lo: number, hi: number): number {
  const range = hi - lo;
  if (!(range > 0)) return lo;
  let t = (x - lo) % range;
  if (t < 0) t += range;
  return lo + t;
}
