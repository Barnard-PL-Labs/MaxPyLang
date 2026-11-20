// AudioWorklet host.
//
// Custom-DSP MSP objects (biquad~, +=~, rampsmooth~, deltaclip~, allpass~, degrade~,
// onepole~, svf~, overdrive~, tanh~, pong~, comb~, pow~) need
// per-sample stateful math that no stock Web Audio node can express. They run inside
// AudioWorkletProcessors whose source is the INLINE string below — a worklet module
// runs in its own global scope and cannot import our TypeScript, so the processors
// re-implement the same math as `src/dsp/kernels.ts`. The kernels are the reference
// and are unit-tested in Node; keep the two in sync when either changes.
//
// Lifecycle: an AudioWorkletNode can only be constructed AFTER its module has been
// added to the context. `preloadWorklets(ctx)` adds the module once and records the
// context as ready; object factories call `workletsReady(ctx)` and only then build a
// real AudioWorkletNode, otherwise they fall back to a plain pass-through gain so they
// still construct in Node (headless mock, no worklet) and in browsers where preload
// was skipped. The set of processor names registered by the module:
export const PROCESSORS = {
  biquad: 'mpl-biquad',
  accum: 'mpl-accum',
  rampsmooth: 'mpl-rampsmooth',
  deltaclip: 'mpl-deltaclip',
  allpass: 'mpl-allpass',
  degrade: 'mpl-degrade',
  onepole: 'mpl-onepole',
  svf: 'mpl-svf',
  shaper: 'mpl-shaper',
  comb: 'mpl-comb',
  pow: 'mpl-pow',
} as const;

// The worklet module source. One class per DSP object; each mirrors the matching
// kernel in src/dsp/kernels.ts. Processors handle every channel with per-channel
// state so stereo signals filter correctly.
const WORKLET_SOURCE = /* js */ `
// Read a k-rate-or-a-rate AudioParam array at sample i.
function pv(arr, i) { return arr.length > 1 ? arr[i] : arr[0]; }

// biquad~ : direct-form I, Max sign convention
//   y = a0*x + a1*x1 + a2*x2 - b1*y1 - b2*y2
class BiquadProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'a0', defaultValue: 1, automationRate: 'k-rate' },
      { name: 'a1', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'a2', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'b1', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'b2', defaultValue: 0, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.st = []; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch];
      const s = this.st[ch] || (this.st[ch] = { x1: 0, x2: 0, y1: 0, y2: 0 });
      for (let i = 0; i < y.length; i++) {
        const a0 = pv(params.a0, i), a1 = pv(params.a1, i), a2 = pv(params.a2, i);
        const b1 = pv(params.b1, i), b2 = pv(params.b2, i);
        const xn = x[i];
        const yn = a0 * xn + a1 * s.x1 + a2 * s.x2 - b1 * s.y1 - b2 * s.y2;
        s.x2 = s.x1; s.x1 = xn; s.y2 = s.y1; s.y1 = yn;
        y[i] = yn;
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSORS.biquad}', BiquadProcessor);

// +=~ : running accumulator  y = y1 + x. A port message { sum } resets the total.
class AccumProcessor extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const init = (opts && opts.processorOptions && opts.processorOptions.initial) || 0;
    this.sum = [];
    this.init = init;
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.sum === 'number') this.sum = this.sum.map(() => e.data.sum);
    };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch];
      if (this.sum[ch] === undefined) this.sum[ch] = this.init;
      let sum = this.sum[ch];
      for (let i = 0; i < y.length; i++) { sum += x[i]; y[i] = sum; }
      this.sum[ch] = sum;
    }
    return true;
  }
}
registerProcessor('${PROCESSORS.accum}', AccumProcessor);

// rampsmooth~ : linear slew limiter over up/down samples
class RampSmoothProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'up', defaultValue: 1, minValue: 1, automationRate: 'k-rate' },
      { name: 'down', defaultValue: 1, minValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.st = []; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch];
      const s = this.st[ch] || (this.st[ch] = { y: 0, target: 0, delta: 0, remaining: 0 });
      for (let i = 0; i < y.length; i++) {
        const up = Math.max(1, Math.floor(pv(params.up, i)));
        const down = Math.max(1, Math.floor(pv(params.down, i)));
        const xn = x[i];
        if (xn !== s.target) {
          s.target = xn;
          const n = xn > s.y ? up : down;
          s.remaining = n;
          s.delta = (xn - s.y) / n;
        }
        if (s.remaining > 0) {
          s.y += s.delta; s.remaining--;
          if (s.remaining === 0) s.y = s.target;
        }
        y[i] = s.y;
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSORS.rampsmooth}', RampSmoothProcessor);

// deltaclip~ : bound the sample-to-sample delta to [lo, hi]
class DeltaClipProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'lo', defaultValue: -1e9, automationRate: 'k-rate' },
      { name: 'hi', defaultValue: 1e9, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.y1 = []; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch];
      if (this.y1[ch] === undefined) this.y1[ch] = 0;
      let y1 = this.y1[ch];
      for (let i = 0; i < y.length; i++) {
        const rawLo = pv(params.lo, i), rawHi = pv(params.hi, i);
        const lo = Math.min(rawLo, rawHi), hi = Math.max(rawLo, rawHi);
        let d = x[i] - y1;
        if (d > hi) d = hi; else if (d < lo) d = lo;
        y1 += d; y[i] = y1;
      }
      this.y1[ch] = y1;
    }
    return true;
  }
}
registerProcessor('${PROCESSORS.deltaclip}', DeltaClipProcessor);

// allpass~ : delaying allpass  y = -g*x + x[n-D] + g*y[n-D]
class AllpassProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'delay', defaultValue: 1, minValue: 1, automationRate: 'k-rate' },
      { name: 'g', defaultValue: 0, automationRate: 'k-rate' },
    ];
  }
  constructor(opts) {
    super();
    const size = Math.max(1, Math.floor((opts && opts.processorOptions && opts.processorOptions.maxDelay) || 4096));
    this.size = size;
    this.st = [];
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch];
      const s = this.st[ch] || (this.st[ch] = { xb: new Float32Array(this.size), yb: new Float32Array(this.size), w: 0 });
      for (let i = 0; i < y.length; i++) {
        const g = pv(params.g, i);
        const D = Math.max(1, Math.min(this.size, Math.floor(pv(params.delay, i))));
        const read = (s.w - D + this.size) % this.size;
        const xd = s.xb[read], yd = s.yb[read];
        const yn = -g * x[i] + xd + g * yd;
        s.xb[s.w] = x[i]; s.yb[s.w] = yn;
        y[i] = yn;
        s.w = (s.w + 1) % this.size;
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSORS.allpass}', AllpassProcessor);

// degrade~ : sample-and-hold at a fraction of the sample rate, then quantise.
//   ratio 1 keeps every sample, 0.25 keeps one in four and holds it for the other three.
//   bits is the word length the held sample is rounded DOWN to, as Max does (24 and up
//   is left alone).
class DegradeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ratio', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bits', defaultValue: 24, minValue: 1, maxValue: 32, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.st = []; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    // Single precision, like Max, so a ratio of 0.1 holds for exactly ten samples.
    const ratio = Math.fround(Math.max(0.0001, Math.min(1, params.ratio[0])));
    const bits = params.bits[0];
    const half = bits >= 24 ? 0 : Math.pow(2, Math.max(1, bits)) / 2;
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch];
      const s = this.st[ch] || (this.st[ch] = { phase: 1, held: 0 });
      for (let i = 0; i < y.length; i++) {
        // Take a new sample first, then advance: the order that lands the holds on the
        // same samples as Max.
        if (s.phase >= 1) {
          s.phase = Math.fround(s.phase - 1);
          s.held = half ? Math.floor(x[i] * half) / half : x[i];
        }
        s.phase = Math.fround(s.phase + ratio);
        y[i] = s.held;
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSORS.degrade}', DegradeProcessor);

// onepole~ : y += g * (x - y), g = 1 - exp(-2*pi*f/sr). 6 dB per octave.
class OnePoleProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'freq', defaultValue: 1000, minValue: 0, automationRate: 'k-rate' }];
  }
  constructor() { super(); this.st = []; }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    // Max takes cutoffs up to a quarter of the sample rate.
    const f = Math.max(0, Math.min(sampleRate / 4, params.freq[0]));
    const g = 1 - Math.exp(-2 * Math.PI * f / sampleRate);
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch];
      let y1 = this.st[ch] || 0;
      for (let i = 0; i < y.length; i++) { y1 += g * (x[i] - y1); y[i] = y1; }
      this.st[ch] = Math.abs(y1) < 1e-30 ? 0 : y1;
    }
    return true;
  }
}
registerProcessor('${PROCESSORS.onepole}', OnePoleProcessor);

// svf~ : Chamberlin state-variable filter. Four outputs: lowpass, highpass, bandpass,
// notch. Matched to Max 9 sample for sample (the difference from a Max recording is its
// 16-bit rounding), which fixed three things a textbook version gets wrong:
//   the frequency coefficient is sin(2*pi*fc/sr), not 2*sin(pi*fc/sr);
//   the damping is (1.2 * (1 - res))^2, capped at 1, so resonance 0.5 is a Q of 2.8 and
//   0.9 is a Q of 67;
//   the cutoff stops at a quarter of the sample rate.
class SvfProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'freq', defaultValue: 1000, minValue: 0, automationRate: 'a-rate' },
      { name: 'res', defaultValue: 0.01, automationRate: 'a-rate' },
    ];
  }
  constructor() { super(); this.low = 0; this.band = 0; }
  process(inputs, outputs, params) {
    const x = inputs[0] && inputs[0][0];
    const lp = outputs[0][0], hp = outputs[1][0], bp = outputs[2][0], nt = outputs[3][0];
    let low = this.low, band = this.band;
    const top = sampleRate / 4;
    for (let i = 0; i < lp.length; i++) {
      const fc = Math.max(0, Math.min(top, pv(params.freq, i)));
      const f = Math.sin(2 * Math.PI * fc / sampleRate);
      const d = 1.2 * (1 - Math.min(1, Math.max(0, pv(params.res, i))));
      const q = Math.max(0.0001, Math.min(1, d * d));
      low += f * band;
      const high = (x ? x[i] : 0) - low - q * band;
      band += f * high;
      lp[i] = low; hp[i] = high; bp[i] = band; nt[i] = high + low;
    }
    this.low = Math.abs(low) < 1e-30 ? 0 : low;
    this.band = Math.abs(band) < 1e-30 ? 0 : band;
    return true;
  }
}
registerProcessor('${PROCESSORS.svf}', SvfProcessor);

// overdrive~, tanh~, pong~ : memoryless curves, not oversampled (Max does not either).
//   overdrive : y = sign(x) * (1 - (1 - |x|)^drive), flat past full scale
//   tanh      : y = tanh(x)
//   fold/wrap/clip : pong~'s three modes between lo and hi
class ShaperProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 1, automationRate: 'a-rate' },
      { name: 'lo', defaultValue: -1, automationRate: 'k-rate' },
      { name: 'hi', defaultValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor(options) {
    super();
    this.mode = (options && options.processorOptions && options.processorOptions.mode) || 'tanh';
    this.port.onmessage = (e) => { if (e.data && e.data.mode) this.mode = e.data.mode; };
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const mode = this.mode, lo = params.lo[0], hi = params.hi[0], range = hi - lo;
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch];
      for (let i = 0; i < y.length; i++) {
        const v = x[i];
        if (mode === 'tanh') y[i] = Math.tanh(v);
        else if (mode === 'overdrive') {
          const a = Math.min(1, Math.abs(v));
          const s = 1 - Math.pow(1 - a, Math.max(0, pv(params.drive, i)));
          y[i] = v < 0 ? -s : s;
        } else if (!(range > 0)) y[i] = lo;
        else if (mode === 'fold') {
          let t = (v - lo) % (2 * range); if (t < 0) t += 2 * range;
          y[i] = lo + (t <= range ? t : 2 * range - t);
        } else if (mode === 'wrap') {
          let t = (v - lo) % range; if (t < 0) t += range;
          y[i] = lo + t;
        } else y[i] = Math.max(lo, Math.min(hi, v));
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSORS.shaper}', ShaperProcessor);

// comb~ : y[n] = a*x[n] + b*x[n-D] + c*y[n-D], D given in milliseconds.
// Matched to Max 9: a delay set by a number is cut down to whole samples, and a delay
// driven by a signal is read between samples (linear), which is what lets a flanger
// sweep it without zipper noise. The signal arrives on the second input; while it is
// connected it replaces the number, as it does in Max.
class CombProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'delay', defaultValue: 0, automationRate: 'a-rate' },
      { name: 'a', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'b', defaultValue: 0, automationRate: 'k-rate' },
      { name: 'c', defaultValue: 0, automationRate: 'k-rate' },
    ];
  }
  constructor(opts) {
    super();
    const maxMs = (opts && opts.processorOptions && opts.processorOptions.maxDelayMs) || 10;
    this.limit = Math.max(1, Math.floor(maxMs * sampleRate / 1000));
    this.size = this.limit + 4;
    this.st = [];
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const a = params.a[0], b = params.b[0], c = params.c[0];
    // An input with nothing feeding it still delivers a block of zeros, and no delay time
    // is zero, so a silent block means "not connected": fall back to the number.
    const sweep = inputs[1] && inputs[1][0];
    const swept = !!sweep && (sweep[0] > 0 || sweep[sweep.length - 1] > 0);
    const size = this.size, limit = this.limit;
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp[ch] || inp[0], y = out[ch];
      const s = this.st[ch] || (this.st[ch] = { xb: new Float32Array(size), yb: new Float32Array(size), w: 0 });
      for (let i = 0; i < y.length; i++) {
        let D = (swept ? sweep[i] : pv(params.delay, i)) * sampleRate / 1000;
        D = D < 1 ? 1 : D > limit ? limit : D;
        const whole = Math.floor(D);
        const r0 = (s.w - whole + size) % size;
        let xd = s.xb[r0], yd = s.yb[r0];
        if (swept) {
          const frac = D - whole, r1 = (r0 - 1 + size) % size;
          xd += frac * (s.xb[r1] - xd);
          yd += frac * (s.yb[r1] - yd);
        }
        const yn = a * x[i] + b * xd + c * yd;
        s.xb[s.w] = x[i];
        s.yb[s.w] = Math.abs(yn) < 1e-30 ? 0 : yn;
        y[i] = yn;
        s.w = (s.w + 1) % size;
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSORS.comb}', CombProcessor);

// pow~ : y = base ^ exponent, as in Max: the exponent is the left inlet (a signal, or a
// number), the base is the right inlet or the argument. Every sample, at any size: a
// WaveShaper can only map inputs between -1 and 1. A result that isn't a number (a
// negative base to a fractional power) is 0, so it can't poison what follows.
class PowProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'base', defaultValue: 0, automationRate: 'a-rate' },
      { name: 'exponent', defaultValue: 0, automationRate: 'k-rate' },
    ];
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    const e0 = params.exponent[0];
    for (let ch = 0; ch < out.length; ch++) {
      const x = inp && inp.length ? (inp[ch] || inp[0]) : null, y = out[ch];
      for (let i = 0; i < y.length; i++) {
        const v = Math.pow(pv(params.base, i), e0 + (x ? x[i] : 0));
        y[i] = Number.isFinite(v) ? v : 0;
      }
    }
    return true;
  }
}
registerProcessor('${PROCESSORS.pow}', PowProcessor);
`;

// Contexts whose worklet module has been successfully loaded.
const ready = new WeakSet<BaseAudioContext>();
// In-flight / completed load promises, so preload is idempotent per context.
const loading = new WeakMap<BaseAudioContext, Promise<void>>();

/**
 * Add the DSP worklet module to `ctx` exactly once. Await this before building any
 * patch that may contain a worklet-backed object. Safe to call repeatedly and safe
 * when the environment has no real AudioWorklet (it simply records nothing ready).
 */
export function preloadWorklets(ctx: BaseAudioContext): Promise<void> {
  const existing = loading.get(ctx);
  if (existing) return existing;
  const wl = (ctx as unknown as { audioWorklet?: { addModule(url: string): Promise<void> } }).audioWorklet;
  // No real worklet support (or the headless mock): nothing to load, stay "not ready"
  // so factories take the pass-through fallback.
  if (!wl || typeof URL === 'undefined' || typeof Blob === 'undefined' || typeof (URL as unknown as { createObjectURL?: unknown }).createObjectURL !== 'function') {
    const p = Promise.resolve();
    loading.set(ctx, p);
    return p;
  }
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
  const p = wl
    .addModule(url)
    .then(() => { ready.add(ctx); })
    .catch((err: unknown) => {
      // Leave the context "not ready" — objects degrade to pass-through rather than throw.
      console.warn('preloadWorklets: addModule failed, DSP objects will pass through', err);
    })
    .finally(() => { URL.revokeObjectURL(url); });
  loading.set(ctx, p);
  return p;
}

/** Has `ctx` finished loading the worklet module (so AudioWorkletNode is buildable)? */
export function workletsReady(ctx: BaseAudioContext): boolean {
  return ready.has(ctx);
}

/**
 * Build an AudioWorkletNode for `name` on `ctx`, or return undefined if worklets
 * aren't ready / construction fails / the environment is the headless mock (whose
 * fake node lacks a real `.parameters` map). Callers fall back to a pass-through.
 */
export function tryWorkletNode(
  ctx: BaseAudioContext,
  name: string,
  options?: AudioWorkletNodeOptions
): AudioWorkletNode | undefined {
  if (!workletsReady(ctx)) return undefined;
  const Ctor = (globalThis as unknown as { AudioWorkletNode?: typeof AudioWorkletNode }).AudioWorkletNode;
  if (typeof Ctor !== 'function') return undefined;
  try {
    const node = new Ctor(ctx, name, options);
    // Guard against the headless mock, whose Proxy returns a fake param (no .get).
    const params = (node as unknown as { parameters?: { get?: unknown } }).parameters;
    if (params && typeof params.get !== 'function') return undefined;
    return node;
  } catch {
    return undefined;
  }
}
