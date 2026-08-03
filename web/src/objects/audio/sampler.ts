// Sampler (MSP) objects — the named-buffer family. A `buffer~` DECLARES a buffer
// under a symbol name; `play~` / `groove~` / `wave~` / `2d.wave~` PLAY it back and
// `record~` writes into it. All references resolve through one module-local
// registry keyed by buffer name, mirroring how Max shares a `buffer~` by name.
//
// Fidelity notes, per the prototype's "recognisably correct sound" bar:
//   • Playback is an AudioBufferSourceNode reading the shared buffer.
//   • Signal-rate lookup driven by a phase/position signal (wave~, index~, poke~)
//     needs sample-accurate random access into the buffer — an AudioWorklet — so
//     those either loop the region (wave~/2d.wave~) or are left as Tier-A stubs.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';

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
// args: name, [filename], [duration ms], [channels]. The filename would load a
// sample in the browser; headless we allocate a zeroed buffer of the given size.
register('buffer~', (args, { ctx }) => {
  const name = bufferName(args);
  // args: [name, filename?, duration?, channels?]. Duration/channels may shift if
  // no filename is present; read them positionally with sane fallbacks.
  const duration = num(args[2], 0);
  const channels = num(args[3], 1);
  const owned = makeEmptyBuffer(ctx, channels, duration);
  bufferRegistry.set(name, owned);
  const o = makeOutlets();
  return {
    signalIns: [undefined], // inlet 0 is control-only
    signalOuts: [undefined, undefined], // both outlets are control
    controlIns: [() => {}],
    onControlOut: o.onControlOut,
    dispose() {
      // Only relinquish the name if we still own this exact buffer.
      if (bufferRegistry.get(name) === owned) bufferRegistry.delete(name);
    },
  } satisfies MaxNode;
});

// ── play~ : plays a named buffer. inlet 0 signal (position), 2 outlets. ──────
// outlet 0 = audio, outlet 1 = control (sync/done). A true position-signal drive
// needs a worklet; the prototype starts the source and outputs its audio.
register('play~', (args, { ctx }) => {
  const name = bufferName(args);
  const buffer = resolveBuffer(name, ctx);
  const src = new AudioBufferSourceNode(ctx, { buffer });
  src.buffer = buffer;
  const out = new GainNode(ctx, { gain: 1 });
  src.connect(out);
  let started = false;
  const startOnce = () => {
    if (started) return;
    started = true;
    try {
      src.start();
    } catch {
      /* already started */
    }
  };
  startOnce();
  const o = makeOutlets();
  return {
    signalIns: [out], // inlet 0 accepts the driving signal (structural)
    signalOuts: [out, undefined], // outlet 1 is control
    controlIns: [
      (m) => {
        // A number acts as a transport toggle for the prototype.
        const n = firstNum(m);
        if (n !== undefined && n !== 0) startOnce();
      },
    ],
    onControlOut: o.onControlOut,
    start: startOnce,
    dispose() {
      try {
        src.stop();
      } catch {
        /* not started */
      }
    },
  } satisfies MaxNode;
});

// ── groove~ : variable-rate looping player. 3 inlets, 2 signal outlets. ──────
// inlet 0 signal drives playback rate; inlets 1/2 set loop start/end (ms).
register('groove~', (args, { ctx }) => {
  const name = bufferName(args);
  const buffer = resolveBuffer(name, ctx);
  const src = new AudioBufferSourceNode(ctx, { buffer, loop: true });
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = 1; // normal-speed default (explicit for headless clarity)
  const outL = new GainNode(ctx, { gain: 1 });
  const outR = new GainNode(ctx, { gain: 1 });
  src.connect(outL);
  src.connect(outR);
  try {
    src.start();
  } catch {
    /* already started */
  }
  return {
    // inlet 0 signal -> playbackRate; loop points are control-only (not AudioParams).
    signalIns: [src.playbackRate, undefined, undefined],
    signalOuts: [outL, outR],
    controlIns: [
      (m) => {
        const n = firstNum(m);
        if (n !== undefined) src.playbackRate.value = n;
      },
      (m) => {
        const n = firstNum(m);
        if (n !== undefined) src.loopStart = n / 1000; // ms -> s
      },
      (m) => {
        const n = firstNum(m);
        if (n !== undefined) src.loopEnd = n / 1000; // ms -> s
      },
    ],
    dispose() {
      try {
        src.stop();
      } catch {
        /* not started */
      }
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
register('wave~', makeRegionPlayer(3)); // buffer-name, start, end
register('2d.wave~', makeRegionPlayer(4)); // buffer-name, x/y phase, start, end, rows
