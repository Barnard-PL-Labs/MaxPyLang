// The "track" around the device: a looping sample in, speakers out.
//
// In Live a device sits on a track; the clip plays into plugin~ and plugout~ feeds the
// mixer. Here this module is the track. It plays a sample into the host input bus and
// takes the host output bus over, so it can offer the two things a track would: bypass
// (hear the sample dry, at the same moment in the loop) and a meter.

import { hostBus } from '../runtime/host';

export interface SampleDef {
  id: string;
  label: string;
  url: string;
}

const FADE = 0.015;

export class Track {
  readonly analyser: AnalyserNode;
  private readonly ctx: AudioContext;
  private readonly feed: GainNode;
  private readonly wet: GainNode;
  private readonly dry: GainNode;
  private readonly master: GainNode;
  private readonly meterSplit: ChannelSplitterNode;
  private readonly meters: AnalyserNode[];
  private readonly meterData: Float32Array<ArrayBuffer>[];
  private source: AudioBufferSourceNode | undefined;
  private buffer: AudioBuffer | undefined;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private bypassed = false;
  playing = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const bus = hostBus(ctx);

    // Whatever the sample's channel count, the device gets two channels: a mono clip
    // is upmixed to both instead of arriving on the left only.
    this.feed = new GainNode(ctx, { gain: 1, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    this.feed.connect(split);
    split.connect(bus.input[0], 0);
    split.connect(bus.input[1], 1);

    this.wet = new GainNode(ctx, { gain: 1 });
    this.dry = new GainNode(ctx, { gain: 0 });
    this.master = new GainNode(ctx, { gain: 1 });
    this.analyser = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0.82 });

    // The bus goes to the speakers by default; from here on it goes through this track.
    bus.output.disconnect();
    bus.output.connect(this.wet).connect(this.master);
    this.feed.connect(this.dry).connect(this.master);
    this.master.connect(this.analyser);
    this.master.connect(ctx.destination);

    this.meterSplit = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    this.master.connect(this.meterSplit);
    this.meters = [0, 1].map((ch) => {
      const a = new AnalyserNode(ctx, { fftSize: 512 });
      this.meterSplit.connect(a, ch);
      return a;
    });
    this.meterData = this.meters.map((a) => new Float32Array(new ArrayBuffer(a.fftSize * 4)));
  }

  /** Fetch and decode a bundled sample, once. */
  load(sample: SampleDef): Promise<AudioBuffer> {
    let p = this.buffers.get(sample.id);
    if (!p) {
      p = fetch(sample.url)
        .then((r) => {
          if (!r.ok) throw new Error(`could not load ${sample.label} (${r.status})`);
          return r.arrayBuffer();
        })
        .then((data) => this.ctx.decodeAudioData(data));
      p.catch(() => this.buffers.delete(sample.id));
      this.buffers.set(sample.id, p);
    }
    return p;
  }

  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  /** Swap what the track plays. If it is playing, the new sample starts immediately. */
  setBuffer(buffer: AudioBuffer): void {
    this.buffer = buffer;
    if (this.playing) this.startSource();
  }

  private startSource(): void {
    this.stopSource();
    if (!this.buffer) return;
    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer, loop: true });
    src.connect(this.feed);
    src.start();
    this.source = src;
  }

  private stopSource(): void {
    const src = this.source;
    this.source = undefined;
    if (!src) return;
    try { src.stop(); } catch { /* never started */ }
    try { src.disconnect(); } catch { /* nothing connected */ }
  }

  play(): void {
    this.playing = true;
    this.startSource();
  }

  stop(): void {
    this.playing = false;
    this.stopSource();
  }

  get bypass(): boolean {
    return this.bypassed;
  }

  set bypass(on: boolean) {
    this.bypassed = on;
    const t = this.ctx.currentTime;
    this.wet.gain.cancelScheduledValues(t);
    this.dry.gain.cancelScheduledValues(t);
    this.wet.gain.setTargetAtTime(on ? 0 : 1, t, FADE);
    this.dry.gain.setTargetAtTime(on ? 1 : 0, t, FADE);
  }

  /**
   * Duck the output around a rebuild of the patch. Tearing the graph down mid-sound is a
   * click; a few milliseconds of fade either side of it is not.
   */
  async duck<T>(work: () => T): Promise<T> {
    if (!this.playing || this.ctx.state !== 'running') return work();
    const g = this.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(0, this.ctx.currentTime, 0.006);
    await new Promise((r) => setTimeout(r, 30));
    try {
      return work();
    } finally {
      g.cancelScheduledValues(this.ctx.currentTime);
      g.setTargetAtTime(1, this.ctx.currentTime + 0.01, 0.012);
    }
  }

  /** Peak level per channel, 0..1, of the last block. */
  levels(): [number, number] {
    const out: number[] = [];
    for (let ch = 0; ch < 2; ch++) {
      const data = this.meterData[ch];
      this.meters[ch].getFloatTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      out.push(peak);
    }
    return [out[0], out[1]];
  }
}
