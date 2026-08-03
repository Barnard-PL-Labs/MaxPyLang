// Audio (MSP) oscillator / noise sources — the "osc" batch. Each maps a Max ~
// source object to Web Audio nodes. Registering this module (side-effect import)
// populates the global registry with Tier-B implementations.
//
// Fidelity target matches the rest of audio/: "recognisably correct sound", not
// sample-accurate parity with Max's DSP. Where Web Audio has no direct control
// (e.g. rect~ pulse-width, tri~ duty-cycle), the parameter is accepted and stored
// but does not yet reshape the waveform — noted inline.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum, BANG } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';
import { scheduler } from '../../runtime/scheduler';

// ── Band-limited oscillators (saw~ / rect~ / tri~) ─────────────────────────────
// All three are OscillatorNodes differing only by `type`. Inlet 0 is frequency
// (signal or float). Extra inlets (phase reset, pulse-width, duty-cycle) exist for
// arity parity but Web Audio's OscillatorNode exposes no matching AudioParam, so
// they are accepted without reshaping the wave.

// saw~ : sawtooth oscillator. inlets [frequency, phase], one signal outlet.
register('saw~', (args, { ctx }) => {
  const osc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: num(args[0], 0) });
  osc.start();
  return {
    signalIns: [osc.frequency, undefined], // inlet 1 = phase reset (unsupported)
    signalOuts: [osc],
    controlIns: [(m) => { const n = firstNum(m); if (n !== undefined) osc.frequency.value = n; }, undefined],
  } satisfies MaxNode;
});

// rect~ : rectangular / square oscillator. inlets [frequency, pulse-width, phase].
// Web Audio 'square' is fixed at 50% duty; the pulse-width arg/inlet is stored only.
register('rect~', (args, { ctx }) => {
  const osc = new OscillatorNode(ctx, { type: 'square', frequency: num(args[0], 0) });
  osc.start();
  return {
    signalIns: [osc.frequency, undefined, undefined],
    signalOuts: [osc],
    controlIns: [
      (m) => { const n = firstNum(m); if (n !== undefined) osc.frequency.value = n; },
      () => {}, // pulse-width: accepted but not yet reshaping the wave
      undefined,
    ],
  } satisfies MaxNode;
});

// tri~ : triangle oscillator. inlets [frequency, duty-cycle, phase].
// Web Audio 'triangle' is a fixed symmetric triangle; duty-cycle is stored only.
register('tri~', (args, { ctx }) => {
  const osc = new OscillatorNode(ctx, { type: 'triangle', frequency: num(args[0], 0) });
  osc.start();
  return {
    signalIns: [osc.frequency, undefined, undefined],
    signalOuts: [osc],
    controlIns: [
      (m) => { const n = firstNum(m); if (n !== undefined) osc.frequency.value = n; },
      () => {}, // duty-cycle: accepted but not yet reshaping the wave
      undefined,
    ],
  } satisfies MaxNode;
});

// ── Noise sources (noise~ / pink~) ─────────────────────────────────────────────
// Web Audio has no noise node, so we fill a looping AudioBuffer with random samples
// and drive it through an AudioBufferSourceNode. Two seconds of samples is long
// enough that the loop point is inaudible.

function makeNoiseBuffer(ctx: BaseAudioContext, fill: (data: Float32Array) => void) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * 2));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  fill(buffer.getChannelData(0));
  const src = new AudioBufferSourceNode(ctx, { buffer, loop: true });
  src.start();
  return src;
}

// noise~ : white noise. Single (inert) inlet, one signal outlet.
register('noise~', (_args, { ctx }) => {
  const src = makeNoiseBuffer(ctx, (data) => {
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  });
  return { signalIns: [undefined], signalOuts: [src] } satisfies MaxNode;
});

// pink~ : pink (1/f) noise via the Paul Kellet filtered-white-noise approximation.
register('pink~', (_args, { ctx }) => {
  const src = makeNoiseBuffer(ctx, (data) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  });
  return { signalIns: [undefined], signalOuts: [src] } satisfies MaxNode;
});

// ── train~ : pulse train ───────────────────────────────────────────────────────
// inlets [inter-pulse-interval(ms), pulse-width, phase]; outlets [signal, control].
// Signal outlet: a square oscillator whose frequency is derived from the interval
// (Hz = 1000 / ms) — a recognisable pulse stream. Control outlet: a bang emitted on
// each pulse via the shared transport scheduler (fires only while ▶ is running).
register('train~', (args, { ctx }) => {
  const osc = new OscillatorNode(ctx, { type: 'square' });
  osc.start();
  const o = makeOutlets();
  let intervalMs = Math.max(1, num(args[0], 1000));

  const applyFreq = () => { osc.frequency.value = 1000 / intervalMs; };
  applyFreq();

  let cancel: (() => void) | null = null;
  const rearm = () => {
    cancel?.();
    cancel = scheduler.everyMs(intervalMs, () => o.emit(1, BANG));
  };
  rearm();

  return {
    signalIns: [undefined, undefined, undefined], // interval/pw/phase are control-set here
    signalOuts: [osc, undefined], // outlet 1 is control, not signal
    controlIns: [
      (m) => { const n = firstNum(m); if (n !== undefined) { intervalMs = Math.max(1, n); applyFreq(); rearm(); } },
      () => {}, // pulse-width: accepted but not yet reshaping the wave
      undefined,
    ],
    onControlOut: o.onControlOut,
    dispose: () => { cancel?.(); cancel = null; },
  } satisfies MaxNode;
});
