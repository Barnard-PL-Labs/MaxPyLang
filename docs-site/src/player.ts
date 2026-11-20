// One shared audio engine for the whole page, and a tap on its output.
//
// The engine keeps a process-wide scheduler and named buses, so two engines on one
// page would share a clock: stopping one would stop the other's metros. Like Hydra,
// the page plays one example at a time through a single Engine.
//
// The tap: ezdac~ is the only object that connects to ctx.destination. TapAudioContext
// returns a GainNode from its `destination` getter instead, which feeds an AnalyserNode
// (for the oscilloscope) and the real speakers. The engine needs no change.

import '../../web/src/objects'; // registers every object implementation (side effect)
import { Engine } from '../../web/src/engine/engine';
import { preloadWorklets } from '../../web/src/runtime/worklet';
import { parseMaxPat } from '../../web/src/parser/maxpat';
import { hostBus } from '../../web/src/runtime/host';

const nativeDestination = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'destination')!.get!;

export class TapAudioContext extends AudioContext {
  readonly analyser: AnalyserNode;
  /** Everything the patch sends to the speakers passes through this; its gain is the volume. */
  readonly tap: GainNode;

  constructor() {
    super();
    const speakers = nativeDestination.call(this) as AudioDestinationNode;
    this.tap = new GainNode(this);
    this.analyser = new AnalyserNode(this, { fftSize: 2048, smoothingTimeConstant: 0.6 });
    this.tap.connect(this.analyser);
    this.tap.connect(speakers);
  }

  // Everything the engine wires "to the speakers" passes through the tap.
  override get destination(): AudioDestinationNode {
    return this.tap as unknown as AudioDestinationNode;
  }
}

let engine: Engine | null = null;
let volume = 1;

/** Set the page's output volume, 0..1. Applies now and to every patch played later. */
export function setVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  const ctx = engine?.ctx as TapAudioContext | undefined;
  ctx?.tap.gain.setTargetAtTime(volume, ctx.currentTime, 0.02); // smooth: no clicks
}

export const getVolume = (): number => volume;
let ready: Promise<Engine> | null = null;
let current: string | null = null;
const listeners = new Set<(playing: string | null) => void>();

function audio(): Promise<Engine> {
  ready ??= (async () => {
    const ctx = new TapAudioContext();
    ctx.tap.gain.value = volume;
    engine = new Engine(ctx);
    await preloadWorklets(ctx);
    return engine;
  })();
  return ready;
}

export function analyser(): AnalyserNode | null {
  return engine ? (engine.ctx as TapAudioContext).analyser : null;
}

// A Max for Live audio effect hears the track it sits on through plugin~. Here there is no
// track, so, as the plugin generator does, a clip plays into the host input while an
// example with plugin~ plays (web/src/runtime/host.ts).
export const TRACK_CLIP = 'samples/fx/guitar.mp3';
const clips = new WeakMap<BaseAudioContext, Promise<AudioBuffer>>();
let track: AudioBufferSourceNode | null = null;

export function loadClip(ctx: BaseAudioContext, url = import.meta.env.BASE_URL + TRACK_CLIP): Promise<AudioBuffer> {
  let p = clips.get(ctx);
  if (!p) {
    p = fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b));
    clips.set(ctx, p);
  }
  return p;
}

/** Loop the clip into the host input: what plugin~ outputs. */
export function playTrack(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const bus = hostBus(ctx);
  const source = new AudioBufferSourceNode(ctx, { buffer, loop: true });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  source.connect(split);
  split.connect(bus.input[0], 0);
  split.connect(bus.input[1], buffer.numberOfChannels > 1 ? 1 : 0);
  source.start();
  return source;
}

const usesTrack = (patch: unknown): boolean =>
  ((patch as { patcher?: { boxes?: { box: { text?: string } }[] } }).patcher?.boxes ?? [])
    .some(({ box }) => (box.text ?? '').split(' ')[0] === 'plugin~');

function stopTrack(): void {
  try { track?.stop(); } catch { /* already stopped */ }
  track?.disconnect();
  track = null;
}

/** Play a patch (maxpat JSON) under a key; whatever was playing stops first. */
export async function play(key: string, patch: unknown): Promise<void> {
  const eng = await audio();
  await eng.stop();
  stopTrack();
  eng.build(parseMaxPat(patch));
  if (usesTrack(patch)) track = playTrack(eng.ctx, await loadClip(eng.ctx));
  await eng.start();
  current = key;
  listeners.forEach((f) => f(current));
}

export async function stop(): Promise<void> {
  stopTrack();
  if (!engine) return;
  await engine.stop();
  engine.clear();
  current = null;
  listeners.forEach((f) => f(current));
}

export const playing = (): string | null => current;

/** The shared engine, for tests and debugging. */
export const engineForTests = () => engine;

/** The DOM the engine built for a box (a number box, a slider…), while a patch is built. */
export function builtWidget(id: string): HTMLElement | undefined {
  return engine?.built.get(id)?.el;
}
export function onChange(f: (playing: string | null) => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
