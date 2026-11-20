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
//   • 2d.wave~ reads rows of it at an X and a Y phase (same worklet).
//   • record~ captures its input in a worklet and writes it into the buffer (in place,
//     keeping the buffer's size), then publishes it so every reader hears the recording.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum, type Msg } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';
import { PROCESSORS, tryWorkletNode } from '../../runtime/worklet';
import type { IRNode } from '../../ir/types';
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

/** A buffer watcher. `partial` is true while record~ is still writing into the buffer
 * (its contents changed in place, more to come); false for a new buffer or a finished take. */
type BufferWatcher = (b: AudioBuffer, partial: boolean) => void;
const watchers = new Map<string, Set<BufferWatcher>>();

/** A numeric `@key value` attribute: from the box's parsed attributes (the engine passes
 * those separately), or from the args themselves when a caller left it in them. */
function attrNum(args: (number | string)[], node: IRNode | undefined, key: string): number | undefined {
  const v = node?.attrs?.[key]?.[0];
  if (v !== undefined) return num(Number(v), 0);
  const at = args.indexOf('@' + key);
  return at >= 0 ? num(args[at + 1], 0) : undefined;
}

/** Put a buffer under a name and tell everything reading that name. */
function publish(name: string, b: AudioBuffer, partial = false): void {
  bufferRegistry.set(name, b);
  for (const f of [...(watchers.get(name) ?? [])]) f(b, partial);
}

/** Call f with the buffer under a name now, and again whenever it changes. */
function watchBuffer(name: string, ctx: BaseAudioContext, f: BufferWatcher): () => void {
  let set = watchers.get(name);
  if (!set) watchers.set(name, (set = new Set()));
  set.add(f);
  f(resolveBuffer(name, ctx), false);
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
function bufferReader(ctx: BaseAudioContext, name: string, mode: 'wave' | 'play' | '2d') {
  const node = tryWorkletNode(ctx, PROCESSORS.bufread, {
    numberOfInputs: mode === '2d' ? 2 : 1,
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
register('groove~', (args, { ctx, node }) => {
  const name = bufferName(args);
  let loop = (attrNum(args, node, 'loop') ?? 0) !== 0;
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
  // While record~ is still writing into the buffer groove~ is playing, keep playing (a
  // new source would restart at the beginning every few ms); a finished take is picked up.
  const unwatch = watchBuffer(name, ctx, (b, partial) => {
    if (partial && src && src.buffer === b) return;
    play(b);
  });
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

// ── record~ : records a signal into a named buffer. ─────────────────────────
// As in Max: args buffer-name, [input channels] (default 1). Inlets: one signal inlet
// per channel, then the record start and end points (ms). A non-zero number into the
// left inlet starts recording at the start point (or where it last stopped, with
// "append 1"); 0 stops. Recording stops when it reaches the end point (default: the
// end of the buffer~) unless "loop 1" is on, when it goes on at the start point. The
// outlet is a sync signal from 0 at the start point to 1 at the end point while
// recording, 0 otherwise. "reset" restores the whole buffer as the range; "set name"
// records into another buffer~. @loop, @append, @loopstart and @loopend as attributes.
// The buffer keeps the size buffer~ gave it: record~ writes into it in place.
register('record~', (args, { ctx, node: box }) => {
  const cut = args.findIndex((a) => typeof a === 'string' && a.startsWith('@'));
  const plain = cut < 0 ? args : args.slice(0, cut);
  let name = bufferName(plain);
  const nch = Math.min(32, Math.max(1, Math.trunc(num(plain[1], 1)) || 1));
  let loop = (attrNum(args, box, 'loop') ?? 0) !== 0;
  let append = (attrNum(args, box, 'append') ?? 0) !== 0;
  let startMs = attrNum(args, box, 'loopstart') ?? 0;
  let endMs = attrNum(args, box, 'loopend') ?? 0;
  const inlets = Array.from({ length: nch }, () => new GainNode(ctx, { gain: 1 }));
  let target = resolveBuffer(name, ctx);
  const node = tryWorkletNode(ctx, PROCESSORS.record, {
    numberOfInputs: nch,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { channels: nch, len: target.length, sr: target.sampleRate, loop, append },
  });
  const sync = node ?? new GainNode(ctx, { gain: 0 }); // no worklet (Node): a silent outlet
  // Web Audio only runs nodes that lead to the speakers; in Max record~ records with
  // nothing on its outlet. A silent path to the destination keeps the worklet running.
  const pull = new GainNode(ctx, { gain: 0 });
  if (node) node.connect(pull).connect(ctx.destination);
  const post = (m: Record<string, number>) => node?.port.postMessage(m);
  post({ start: startMs, end: endMs });

  // Write what the worklet captured into the buffer, and tell its readers (at most
  // every 40 ms while recording; at once when a take ends).
  let pending: ReturnType<typeof setTimeout> | undefined;
  const flushPublish = (partial: boolean) => {
    if (pending !== undefined) { clearTimeout(pending); pending = undefined; }
    publish(name, target, partial);
  };
  if (node) {
    node.port.onmessage = (e: MessageEvent) => {
      const d = e.data as { at?: number; channels?: Float32Array<ArrayBuffer>[]; stopped?: boolean };
      if (d.channels && typeof d.at === 'number') {
        const at = d.at;
        if (at >= target.length) return;
        const n = Math.min(d.channels[0]?.length ?? 0, target.length - at);
        for (let c = 0; c < Math.min(d.channels.length, target.numberOfChannels); c++) {
          target.copyToChannel(d.channels[c].subarray(0, n), c, at);
        }
        if (pending === undefined) pending = setTimeout(() => flushPublish(true), 40);
      }
      if (d.stopped) flushPublish(false);
    };
  }
  // Follow the buffer~ under the name (it may load a file, or be made after record~).
  let unwatch = () => {};
  const follow = () => {
    unwatch();
    unwatch = watchBuffer(name, ctx, (b) => {
      if (b === target) return; // our own writes, or the buffer we already have
      target = b;
      post({ len: b.length, sr: b.sampleRate });
    });
  };
  follow();
  inlets.forEach((g, i) => { if (node) g.connect(node, 0, i); });

  const ms = firstNum;
  const controlIns: (((m: Msg) => void) | undefined)[] = [];
  controlIns[0] = (m) => {
    const verb = m[0];
    if (verb === 'loop') { loop = num(m[1], 0) !== 0; post({ loop: loop ? 1 : 0 }); return; }
    if (verb === 'append') { append = num(m[1], 0) !== 0; post({ append: append ? 1 : 0 }); return; }
    if (verb === 'reset') { startMs = 0; endMs = 0; post({ start: 0, end: 0 }); return; }
    if (verb === 'loopstart') { startMs = num(m[1], 0); post({ start: startMs }); return; }
    if (verb === 'loopend') { endMs = num(m[1], 0); post({ end: endMs }); return; }
    if (verb === 'set' && m[1] !== undefined) {
      post({ rec: 0 });
      name = String(m[1]);
      follow();
      return;
    }
    const n = ms(m);
    if (n !== undefined) post({ rec: Math.trunc(n) !== 0 ? 1 : 0 });
  };
  for (let i = 1; i < nch; i++) controlIns[i] = () => {};
  controlIns[nch] = (m) => { const n = ms(m); if (n !== undefined) { startMs = n; post({ start: n }); } };
  controlIns[nch + 1] = (m) => { const n = ms(m); if (n !== undefined) { endMs = n; post({ end: n }); } };
  return {
    signalIns: [...inlets, undefined, undefined],
    signalOuts: [sync],
    controlIns,
    dispose() {
      unwatch();
      if (pending !== undefined) clearTimeout(pending);
      if (node) { node.port.onmessage = null; try { node.disconnect(); } catch { /* nothing connected */ } }
      try { pull.disconnect(); } catch { /* nothing connected */ }
      for (const g of inlets) { try { g.disconnect(); } catch { /* nothing connected */ } }
    },
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

// 2d.wave~ : as in Max, args buffer-name, start, end (ms), channels, rows. The region is
// split into rows; the signal into inlet 0 (X, 0..1) is the position within a row, and
// the signal into inlet 1 (Y, 0..1) picks the row, blending neighbours. Inlets 2 and 3
// set start and end; a "rows n" message sets the number of rows.
register('2d.wave~', (args, { ctx }) => {
  const name = bufferName(args);
  const reader = bufferReader(ctx, name, '2d');
  if (!reader) return makeRegionPlayer(4)(args, { ctx });
  const y = new GainNode(ctx, { gain: 1 }); // the Y phase signal, into the worklet's input 1
  y.connect(reader.node, 0, 1);
  const start = reader.node.parameters.get('start')!;
  const end = reader.node.parameters.get('end')!;
  const rows = reader.node.parameters.get('rows')!;
  start.value = num(args[1], 0);
  end.value = num(args[2], 0);
  rows.value = Math.max(1, num(args[4], 1));
  return {
    signalIns: [reader.node, y, start, end],
    signalOuts: [reader.node],
    controlIns: [
      (m) => { if (m[0] === 'rows') { const n = num(m[1], 1); rows.value = Math.max(1, n); } },
      () => {},
      (m) => { const n = firstNum(m); if (n !== undefined) start.value = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) end.value = n; },
    ],
    dispose: () => { reader.dispose(); try { y.disconnect(); } catch { /* nothing connected */ } },
  } satisfies MaxNode;
});
