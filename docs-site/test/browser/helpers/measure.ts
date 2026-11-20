// Measuring what an example really does, so a test can hold it to what its text says.
//
//   run(object, index, { seconds, listen })  renders the example's patch offline, the way
//       examples.test.ts does (fake timers and clock stepped with the audio, a fixed random
//       sequence, sample files waited for), and records what chosen boxes send, with the
//       audio time of each message.
//   pitch / rms / peak                      measure the rendered sound in a time window.
//   runVideo(object, index, picture)        runs a Jitter example with a test picture in
//       place of the camera and reads back what each jit.pwindow / jit.window shows.
//
// Boxes are named by their text as the patch shows it: "mtof", "counter 60 67", or just
// the first word ("counter"); `nth` picks among several (0 = first in the patch).

import { vi } from 'vitest';
import '../../../../web/src/objects';
import { Engine } from '../../../../web/src/engine/engine';
import { parseMaxPat } from '../../../../web/src/parser/maxpat';
import { preloadWorklets } from '../../../../web/src/runtime/worklet';
import examplesFile from '../../../src/generated/examples.json';
import { loadClip, playTrack } from '../../../src/player';

export const SR = 44100;
const STEP = 0.01; // seconds of audio per clock step
const SAMPLE_WAIT_MS = 1500;
const realSetTimeout = globalThis.setTimeout.bind(globalThis);

type Atom = number | string;
type Box = { box: { id: string; text?: string; maxclass: string } };
export interface Example { object: string; index: number; title: string; note: string; code: string; objects: string[]; patch: { patcher: { boxes: Box[] } } }

export const examples = examplesFile as unknown as Example[];

/** One example, by object name and index; throws if there is none. */
export function example(object: string, index = 0): Example {
  const ex = examples.find((e) => e.object === object && e.index === index);
  if (!ex) throw new Error(`no example ${object}/${index}`);
  return ex;
}

const textOf = (b: Box) => b.box.text ?? b.box.maxclass;

/** The ids of boxes matching a name (full text, or first word), in patch order. */
export function boxIds(ex: Example, name: string): string[] {
  return ex.patch.patcher.boxes
    .filter((b) => textOf(b) === name || textOf(b).split(' ')[0] === name)
    .map((b) => b.box.id);
}

export interface Listen { box: string; outlet?: number; nth?: number; label?: string }
export interface Heard { t: number; msg: Atom[] }

export interface Rendered {
  left: Float32Array;
  right: Float32Array;
  /** What each listened-to box sent, by label (default: the box name), with times in s. */
  heard: Record<string, Heard[]>;
}

/** A fixed sequence for Math.random, so random examples render the same every time. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Render an example offline for `seconds`, recording what the listened-to boxes send. */
export async function run(object: string, index = 0, opts: { seconds?: number; listen?: Listen[] } = {}): Promise<Rendered> {
  const ex = example(object, index);
  const seconds = opts.seconds ?? 2.5;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  const rand = vi.spyOn(Math, 'random').mockImplementation(seeded(1));
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const engine = new Engine(ctx);
  try {
    await preloadWorklets(ctx);
    engine.build(parseMaxPat(ex.patch));
    const nodes = (engine as unknown as { nodes: Map<string, { onControlOut?: (o: number, cb: (m: Atom[]) => void) => void }> }).nodes;
    let now = 0;
    const heard: Record<string, Heard[]> = {};
    for (const l of opts.listen ?? []) {
      const id = boxIds(ex, l.box)[l.nth ?? 0];
      if (!id) throw new Error(`${object}/${index} has no box "${l.box}"${l.nth ? ` #${l.nth}` : ''}`);
      const label = l.label ?? l.box;
      heard[label] = [];
      nodes.get(id)?.onControlOut?.(l.outlet ?? 0, (m) => heard[label].push({ t: now, msg: [...m] }));
    }
    const names = ex.patch.patcher.boxes.map((b) => textOf(b).split(' ')[0]);
    if (names.includes('plugin~')) playTrack(ctx, await loadClip(ctx));
    const waitForSamples = names.includes('playlist~') || names.includes('buffer~');
    await engine.start();
    const length = Math.round(SR * seconds);
    for (let t = STEP; t < seconds; t += STEP) {
      const at = Math.round((t * SR) / 128) * 128 / SR;
      // A suspend must fall inside the render; one at or past its end is rejected.
      if (Math.round(at * SR) >= length - 128) break;
      const first = t === STEP;
      void ctx.suspend(at).then(async () => {
        if (first && waitForSamples) await new Promise((r) => realSetTimeout(r, SAMPLE_WAIT_MS));
        now = at;
        vi.advanceTimersByTime(STEP * 1000);
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

const slice = (x: Float32Array, t0: number, t1: number) => x.subarray(Math.round(t0 * SR), Math.round(t1 * SR));

/** Root-mean-square level between t0 and t1 (s). A steady sine of amplitude a gives a/√2. */
export function rms(x: Float32Array, t0: number, t1: number): number {
  const s = slice(x, t0, t1);
  let sum = 0;
  for (const v of s) sum += v * v;
  return Math.sqrt(sum / Math.max(1, s.length));
}

/** Largest absolute sample between t0 and t1 (s). */
export function peak(x: Float32Array, t0 = 0, t1 = x.length / SR): number {
  let p = 0;
  for (const v of slice(x, t0, t1)) p = Math.max(p, Math.abs(v));
  return p;
}

/**
 * The pitch (Hz) between t0 and t1, from the strongest repeat of the waveform (autocorrelation,
 * searched from 40 Hz to 2 kHz). Good for steady periodic tones; for noise it means little.
 * When two lags score alike (a wave whose cycles repeat in pairs), the shorter one wins.
 */
export function pitch(x: Float32Array, t0: number, t1: number): number {
  const s = slice(x, t0, t1);
  const minLag = Math.floor(SR / 2000), maxLag = Math.min(Math.floor(SR / 40), Math.floor(s.length / 2));
  const scores: number[] = [];
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0, e = 0;
    for (let i = 0; i + lag < s.length; i++) { c += s[i] * s[i + lag]; e += s[i] * s[i] + s[i + lag] * s[i + lag]; }
    const score = e > 0 ? (2 * c) / e : 0;
    scores[lag] = score;
    if (score > best) best = score;
  }
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (scores[lag] >= 0.9 * best && scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1]) return SR / lag;
  }
  return 0;
}

/** Values of the first item of each message heard, in order. */
export const firsts = (h: Heard[]): Atom[] => h.map((x) => x.msg[0]);

// ── Video ────────────────────────────────────────────────────────────────────

/** A test picture: a canvas drawn by `paint` (default: red rising left to right, G 100, B 50). */
export function testPicture(paint?: (cx: CanvasRenderingContext2D, w: number, h: number) => void, w = 320, h = 240): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d')!;
  if (paint) paint(cx, w, h);
  else for (let x = 0; x < w; x++) { cx.fillStyle = `rgb(${Math.round((x * 255) / (w - 1))},100,50)`; cx.fillRect(x, 0, 1, h); }
  return c;
}

export interface Shown {
  width: number;
  height: number;
  /** RGB at a point given as fractions of the width and height. */
  rgb(fx: number, fy: number): [number, number, number];
  /** How many times the colour changes along the middle row (detail left after pixelation). */
  stepsAcross(): number;
}

/**
 * Run a Jitter example in real time with `picture` in place of every jit.grab, for `ms`,
 * then read what each jit.pwindow / jit.window shows (in patch order).
 */
export async function runVideo(object: string, index = 0, picture = testPicture(), opts: { ms?: number; listen?: Listen[] } = {}): Promise<{ shown: Shown[]; heard: Record<string, Heard[]> }> {
  const ex = example(object, index);
  const ctx = new AudioContext();
  const engine = new Engine(ctx);
  try {
    engine.build(parseMaxPat(ex.patch));
    const nodes = (engine as unknown as { nodes: Map<string, any> }).nodes;
    for (const id of boxIds(ex, 'jit.grab')) {
      const n = nodes.get(id);
      n.start = () => {};
      n.videoOuts[0].getFrame = () => ({ source: picture, width: picture.width, height: picture.height });
    }
    const heard: Record<string, Heard[]> = {};
    const t0 = performance.now();
    for (const l of opts.listen ?? []) {
      const id = boxIds(ex, l.box)[l.nth ?? 0];
      const label = l.label ?? l.box;
      heard[label] = [];
      nodes.get(id)?.onControlOut?.(l.outlet ?? 0, (m: Atom[]) => heard[label].push({ t: (performance.now() - t0) / 1000, msg: [...m] }));
    }
    await engine.start();
    await new Promise((r) => setTimeout(r, opts.ms ?? 800));
    const shown: Shown[] = [];
    for (const b of ex.patch.patcher.boxes) {
      const name = textOf(b).split(' ')[0];
      if (name !== 'jit.pwindow' && name !== 'jit.window') continue;
      const el = nodes.get(b.box.id)?.el as HTMLCanvasElement;
      const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
      const at = (x: number, y: number) => (y * el.width + x) * 4;
      shown.push({
        width: el.width,
        height: el.height,
        rgb: (fx, fy) => {
          const i = at(Math.min(el.width - 1, Math.floor(fx * el.width)), Math.min(el.height - 1, Math.floor(fy * el.height)));
          return [d[i], d[i + 1], d[i + 2]];
        },
        stepsAcross: () => {
          const y = Math.floor(el.height / 2);
          let n = 0;
          for (let x = 1; x < el.width; x++) if (d[at(x, y)] !== d[at(x - 1, y)]) n++;
          return n;
        },
      });
    }
    return { shown, heard };
  } finally {
    await engine.stop();
    engine.clear();
    await ctx.close();
  }
}
