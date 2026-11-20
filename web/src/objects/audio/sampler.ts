// Sampler (MSP) objects — the named-buffer family. A `buffer~` DECLARES a buffer
// under a symbol name; `play~` / `groove~` / `wave~` / `2d.wave~` PLAY it back and
// `record~` writes into it. All references resolve through one module-local
// registry keyed by buffer name, mirroring how Max shares a `buffer~` by name.
//
// How each one reads the buffer:
//   • buffer~ loads the sound file it names (see samples.ts for where files come from).
//     Loading takes a moment, so readers WATCH the name and pick up the new buffer.
//   • wave~ and play~ read it at the position a signal gives, in a worklet (bufread).
//   • groove~ is an AudioBufferSourceNode whose speed is the signal into inlet 0.
//   • 2d.wave~ still loops its region, and record~ doesn't write yet.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';
import { PROCESSORS, tryWorkletNode } from '../../runtime/worklet';
import { loadBufferSource, resolveBufferFile } from './samples';

// ── Named-buffer registry ───────────────────────────────────────────────────
// Module-local so a patch's buffer~ and its readers share one AudioBuffer by name.
const bufferRegistry = new Map<string, AudioBuffer>();

/** Buffer name from the first (symbol) arg, defaulting to a stable placeholder. */
function bufferName(args: (number | string)[]): string {
  const a = args[0];
  return a === undefined || a === '' ? 'buffer' : String(a);
}

/** Allocate a zeroed buffer. Empty (1 sample) is a fine default per the spec.
 * Channel count and length are clamped to sane bounds so garbage args (e.g. a
 * billion channels or a billion-ms duration) can never trigger a huge allocation. */
function makeEmptyBuffer(ctx: BaseAudioContext, channels: number, durationMs: number): AudioBuffer {
  const ch = Math.min(32, Math.max(1, Math.trunc(channels) || 1)); // Web Audio caps at 32 channels
  const maxLen = Math.max(1, Math.round(ctx.sampleRate * 60)); // cap at 60s of memory
  const len = Math.min(maxLen, Math.max(1, Math.round((durationMs / 1000) * ctx.sampleRate)));
  return ctx.createBuffer(ch, len, ctx.sampleRate);
}

const watchers = new Map<string, Set<(b: AudioBuffer) => void>>();

/** Put a buffer under a name and tell everything reading that name. */
function publish(name: string, b: AudioBuffer): void {
  bufferRegistry.set(name, b);
  for (const f of watchers.get(name) ?? []) f(b);
}

/** Call f with the buffer under a name now, and again whenever it changes. */
function watchBuffer(name: string, ctx: BaseAudioContext, f: (b: AudioBuffer) => void): () => void {
  let set = watchers.get(name);
  if (!set) watchers.set(name, (set = new Set()));
  set.add(f);
  f(resolveBuffer(name, ctx));
  return () => { set!.delete(f); };
}

/** Resolve a named buffer, creating an empty placeholder if none is declared. */
function resolveBuffer(name: string, ctx: BaseAudioContext): AudioBuffer {
  let b = bufferRegistry.get(name);
  if (!b) {
    b = makeEmptyBuffer(ctx, 1, 0);
    bufferRegistry.set(name, b);
  }
  return b;
}

// ── buffer~ : declares a named buffer. 1 inlet, 2 control outlets. ───────────
// args: name, [filename], [duration ms], [channels], as in Max (a number in second place
// is the duration: there is no file). The file is loaded, and every reader of the name
// gets it; so does a "read file" or "replace file" message. When the file has loaded,
// the right outlet bangs. A name nothing can supply leaves the buffer silent.
register('buffer~', (args, { ctx }) => {
  const name = bufferName(args);
  const file = typeof args[1] === 'string' && !args[1].startsWith('@') ? args[1] : undefined;
  const rest = file ? args.slice(2) : args.slice(1);
  let owned = makeEmptyBuffer(ctx, num(rest[1], 1), num(rest[0], 0));
  publish(name, owned);
  const o = makeOutlets();
  let disposed = false;
  const load = (fileName: string) => {
    const source = resolveBufferFile(fileName);
    if (!source) return;
    loadBufferSource(ctx, source).then(
      (b) => {
        if (disposed || bufferRegistry.get(name) !== owned) return;
        owned = b;
        publish(name, b);
        o.emit(1, ['bang']);
      },
      () => { /* the file couldn't be fetched or decoded: the buffer stays silent */ }
    );
  };
  if (file) load(file);
  return {
    signalIns: [undefined], // inlet 0 is control-only
    signalOuts: [undefined, undefined], // both outlets are control
    controlIns: [
      (m) => {
        const [verb, fileName] = m;
        if ((verb === 'read' || verb === 'replace') && typeof fileName === 'string') load(fileName);
      },
    ],
    onControlOut: o.onControlOut,
    dispose() {
      disposed = true;
      // Only relinquish the name if we still own this exact buffer.
      if (bufferRegistry.get(name) === owned) bufferRegistry.delete(name);
    },
  } satisfies MaxNode;
});

/** A worklet that reads a named buffer (wave~, play~), fed the buffer as it changes. */
function bufferReader(ctx: BaseAudioContext, name: string, mode: 'wave' | 'play') {
  const node = tryWorkletNode(ctx, PROCESSORS.bufread, {
    numberOfInputs: 1,
    outputChannelCount: [1],
    processorOptions: { mode },
  });
  if (!node) return undefined;
  const unwatch = watchBuffer(name, ctx, (b) => {
    const channels = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c).slice());
    node.port.postMessage({ channels, sr: b.sampleRate });
  });
  const dispose = () => {
    unwatch();
    try { node.disconnect(); } catch { /* nothing connected */ }
  };
  return { node, dispose };
}

// ── play~ : plays a named buffer. inlet 0 signal (position), 2 outlets. ──────
// As in Max, the signal into inlet 0 is the position in the buffer, in ms (usually
// from line~), and play~ outputs the sample there. Outlet 1 is control.
register('play~', (args, { ctx }) => {
  const name = bufferName(args);
  const reader = bufferReader(ctx, name, 'play');
  const o = makeOutlets();
  if (reader) {
    return {
      signalIns: [reader.node],
      signalOuts: [reader.node, undefined],
      controlIns: [() => {}],
      onControlOut: o.onControlOut,
      dispose: reader.dispose,
    } satisfies MaxNode;
  }
  // Without worklets (Node), a silent node with the same ports.
  const out = new GainNode(ctx, { gain: 0 });
  return {
    signalIns: [out],
    signalOuts: [out, undefined],
    controlIns: [() => {}],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── groove~ : variable-rate looping player. 3 inlets, 2 signal outlets. ──────
// As in Max: the signal into inlet 0 is the playback speed (1 = normal, 0 = stopped,
// and nothing connected means stopped); a number there sets a constant speed. It plays
// once, or loops between loop min and loop max (inlets 1 and 2, ms) after "loop 1" or
// with @loop 1. When buffer~ loads a file, playback restarts on the new sound.
register('groove~', (args, { ctx }) => {
  const name = bufferName(args);
  const at = args.indexOf('@loop');
  let loop = at >= 0 && num(args[at + 1], 0) !== 0;
  let speed = 0;
  let loopStart = 0, loopEnd = 0;
  const rate = new GainNode(ctx, { gain: 1 }); // a speed signal arrives here
  const outL = new GainNode(ctx, { gain: 1 });
  const outR = new GainNode(ctx, { gain: 1 });
  let src: AudioBufferSourceNode | null = null;
  const applyLoop = () => {
    if (!src) return;
    src.loop = loop;
    src.loopStart = loopStart / 1000;
    src.loopEnd = loopEnd > loopStart ? loopEnd / 1000 : 0;
  };
  const play = (buffer: AudioBuffer) => {
    if (src) { try { src.stop(); } catch { /* not started */ } src.disconnect(); }
    src = new AudioBufferSourceNode(ctx, { buffer });
    src.playbackRate.value = speed;
    rate.connect(src.playbackRate);
    applyLoop();
    src.connect(outL);
    src.connect(outR);
    try { src.start(); } catch { /* already started */ }
  };
  const unwatch = watchBuffer(name, ctx, play);
  return {
    signalIns: [rate, undefined, undefined],
    signalOuts: [outL, outR],
    controlIns: [
      (m) => {
        if (m[0] === 'loop') { loop = num(m[1], 0) !== 0; applyLoop(); return; }
        const n = firstNum(m);
        if (n !== undefined) { speed = n; if (src) src.playbackRate.value = n; }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) { loopStart = n; applyLoop(); } },
      (m) => { const n = firstNum(m); if (n !== undefined) { loopEnd = n; applyLoop(); } },
    ],
    dispose() {
      unwatch();
      if (src) { try { src.stop(); } catch { /* not started */ } }
    },
  } satisfies MaxNode;
});

// ── record~ : records a signal into a named buffer. 3 inlets, 1 signal outlet. ─
// True sample capture into the buffer needs an AudioWorklet; the prototype wires
// the input through and exposes a record-arm toggle + a (silent) sync outlet.
register('record~', (args, { ctx }) => {
  const name = bufferName(args);
  resolveBuffer(name, ctx); // ensure the target buffer exists
  const input = new GainNode(ctx, { gain: 1 });
  const sync = new GainNode(ctx, { gain: 0 }); // sync/position outlet, quiet for now
  let armed = false;
  return {
    signalIns: [input, undefined, undefined], // inlet 0 = signal to record
    signalOuts: [sync],
    controlIns: [
      (m) => {
        const n = firstNum(m);
        if (n !== undefined) armed = n !== 0; // 1 = record, 0 = stop
        void armed;
      },
      () => {},
      () => {},
    ],
  } satisfies MaxNode;
});

// ── wave~ : plays a region of a named buffer. 3 inlets, 1 signal outlet. ─────
// A wavetable read scanned by a phase signal needs a worklet; the prototype loops
// the [start,end] region as a recognisable stand-in. inlets 1/2 set start/end (ms).
function makeRegionPlayer(numInlets: number) {
  return (args: (number | string)[], { ctx }: { ctx: BaseAudioContext }): MaxNode => {
    const name = bufferName(args);
    const buffer = resolveBuffer(name, ctx);
    const src = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    src.buffer = buffer;
    src.loop = true;
    const out = new GainNode(ctx, { gain: 1 });
    src.connect(out);
    try {
      src.start();
    } catch {
      /* already started */
    }
    const signalIns: (AudioNode | AudioParam | undefined)[] = new Array(numInlets).fill(undefined);
    signalIns[0] = out; // inlet 0 accepts the driving phase signal (structural)
    const controlIns: (((m: import('../../runtime/atoms').Msg) => void) | undefined)[] = [];
    for (let i = 0; i < numInlets; i++) controlIns[i] = () => {};
    // Two spare inlets carry region start/end in ms.
    controlIns[numInlets - 2] = (m) => {
      const n = firstNum(m);
      if (n !== undefined) src.loopStart = n / 1000;
    };
    controlIns[numInlets - 1] = (m) => {
      const n = firstNum(m);
      if (n !== undefined) src.loopEnd = n / 1000;
    };
    return {
      signalIns,
      signalOuts: [out],
      controlIns,
      dispose() {
        try {
          src.stop();
        } catch {
          /* not started */
        }
      },
    };
  };
}
// wave~ : as in Max, the signal into inlet 0 is a phase from 0 to 1 across the region
// from start to end (ms; inlets 1 and 2, or the arguments); 0 as the end means the end
// of the buffer. Read per sample in a worklet; without worklets, the region loop above.
register('wave~', (args, { ctx }) => {
  const name = bufferName(args);
  const reader = bufferReader(ctx, name, 'wave');
  if (!reader) return makeRegionPlayer(3)(args, { ctx });
  const start = reader.node.parameters.get('start')!;
  const end = reader.node.parameters.get('end')!;
  start.value = num(args[1], 0);
  end.value = num(args[2], 0);
  return {
    signalIns: [reader.node, start, end],
    signalOuts: [reader.node],
    controlIns: [
      () => {},
      (m) => { const n = firstNum(m); if (n !== undefined) start.value = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) end.value = n; },
    ],
    dispose: reader.dispose,
  } satisfies MaxNode;
});

register('2d.wave~', makeRegionPlayer(4)); // buffer-name, x/y phase, start, end, rows
