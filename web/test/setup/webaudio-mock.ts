// Headless Web Audio mock for Node test runs.
//
// It does NOT produce sound — it lets every object be *instantiated and wired*
// without a browser, so signature/fuzz/unit tests can verify structure (correct
// inlet/outlet arity, no-throw construction, control routing) for all ~1000
// objects. Real acoustic assertions run separately in Vitest browser mode, where
// OfflineAudioContext is the genuine implementation.
//
// The node mock is Proxy-based: any property access that isn't a known method
// returns a fake AudioParam. That way new object types agents add (using new node
// kinds or params) keep working here without touching this file.

class FakeParam {
  value: number;
  automationRate = 'a-rate';
  constructor(v = 0) {
    this.value = v;
  }
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
  setTargetAtTime() { return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
}

function fakeNode(ctx: unknown, opts: Record<string, unknown> = {}): any {
  const params: Record<string, FakeParam> = {};
  const props: Record<string, unknown> = {};
  const base: Record<string, unknown> = {
    context: ctx,
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
    connect: (dest: unknown) => dest, // returns dest so a.connect(b).connect(c) chains
    disconnect: () => {},
    start: () => {},
    stop: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    port: { postMessage: () => {}, onmessage: null }, // AudioWorkletNode-ish
  };
  for (const [k, v] of Object.entries(opts)) {
    if (typeof v === 'number') params[k] = new FakeParam(v);
    else props[k] = v;
  }
  return new Proxy(base, {
    get(t, p: string) {
      if (p in t) return (t as Record<string, unknown>)[p];
      if (p in props) return props[p];
      return (params[p] ??= new FakeParam(0));
    },
    set(t, p: string, v) {
      if (p in t) { (t as Record<string, unknown>)[p] = v; return true; }
      if (typeof v === 'number') (params[p] ??= new FakeParam(0)).value = v;
      else props[p] = v;
      return true;
    },
    has() { return true; },
  });
}

function fakeBuffer(channels: number, length: number, sampleRate: number) {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch: number) => data[ch] ?? new Float32Array(length),
    copyFromChannel: () => {},
    copyToChannel: () => {},
  };
}

class BaseCtx {
  sampleRate = 44100;
  currentTime = 0;
  destination = fakeNode(this);
  audioWorklet = { addModule: async () => {} };
  createGain() { return fakeNode(this); }
  createOscillator() { return fakeNode(this); }
  createConstantSource() { return fakeNode(this); }
  createBiquadFilter() { return fakeNode(this); }
  createWaveShaper() { return fakeNode(this); }
  createChannelMerger() { return fakeNode(this); }
  createChannelSplitter() { return fakeNode(this); }
  createDelay() { return fakeNode(this); }
  createBufferSource() { return fakeNode(this); }
  createStereoPanner() { return fakeNode(this); }
  createPanner() { return fakeNode(this); }
  createAnalyser() { return fakeNode(this); }
  createDynamicsCompressor() { return fakeNode(this); }
  createConvolver() { return fakeNode(this); }
  createIIRFilter() { return fakeNode(this); }
  createBuffer(ch: number, len: number, sr: number) { return fakeBuffer(ch, len, sr ?? this.sampleRate); }
  decodeAudioData() { return Promise.resolve(fakeBuffer(2, 1, this.sampleRate)); }
}

class FakeAudioContext extends BaseCtx {
  state = 'suspended';
  async suspend() { this.state = 'suspended'; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}

class FakeOfflineAudioContext extends BaseCtx {
  length: number;
  constructor(_channels: number, length: number, sampleRate: number) {
    super();
    this.sampleRate = sampleRate ?? 44100;
    this.length = length ?? 1;
  }
  async startRendering() { return fakeBuffer(2, this.length, this.sampleRate); }
}

// A node constructor: `new GainNode(ctx, opts)` returns the fake (a function that
// returns an object makes `new` yield that object).
function nodeCtor() {
  return function (this: unknown, ctx: unknown, opts?: Record<string, unknown>) {
    return fakeNode(ctx, opts ?? {});
  } as unknown as { new (ctx: unknown, opts?: Record<string, unknown>): any };
}

const g = globalThis as Record<string, unknown>;
g.AudioContext = FakeAudioContext;
g.OfflineAudioContext = FakeOfflineAudioContext;
g.BaseAudioContext = BaseCtx;
g.AudioParam = FakeParam;
g.AudioNode = class {};
for (const name of [
  'OscillatorNode', 'GainNode', 'ConstantSourceNode', 'BiquadFilterNode',
  'WaveShaperNode', 'ChannelMergerNode', 'ChannelSplitterNode', 'DelayNode',
  'AudioBufferSourceNode', 'StereoPannerNode', 'PannerNode', 'AnalyserNode',
  'DynamicsCompressorNode', 'ConvolverNode', 'IIRFilterNode', 'AudioWorkletNode',
]) {
  g[name] = nodeCtor();
}
