// AudioWorklet host.
//
// Custom-DSP MSP objects (biquad~, +=~, rampsmooth~, deltaclip~, allpass~) need
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
