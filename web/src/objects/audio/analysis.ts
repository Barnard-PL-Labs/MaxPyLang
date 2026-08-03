// Analysis (MSP) objects — signal-domain taps that report into the CONTROL domain.
//
// meter~, snapshot~, avg~, peakamp~, number~ and edge~ all listen to a signal and
// emit numeric/bang messages on their control outlets. In Web Audio a read-only tap
// is an AnalyserNode: the signal flows in, and we periodically (via the shared
// transport scheduler) or on-demand (via a bang) read its time-domain samples and
// derive a level. thresh~ is the one signal->signal object here (a Schmitt-style
// gate), approximated with a WaveShaper.
//
// Fidelity notes are inline. The goal is "recognisably correct" reporting, not
// sample-accurate parity with Max's DSP — sub-sample edge timing and true hysteresis
// need an AudioWorklet and are left as approximations.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum, isBang, BANG, type Msg } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';
import { scheduler } from '../../runtime/scheduler';

const BUF = 1024; // time-domain window we scan each read

// Read the analyser's current time-domain window into `buf`. In a headless mock the
// method is absent, so we guard and report silence (0) rather than throwing.
function sample(analyser: AnalyserNode, buf: Float32Array): boolean {
  const fn = (analyser as unknown as { getFloatTimeDomainData?: (b: Float32Array) => void })
    .getFloatTimeDomainData;
  if (typeof fn === 'function') {
    fn.call(analyser, buf);
    return true;
  }
  return false;
}

function peakOf(analyser: AnalyserNode, buf: Float32Array): number {
  if (!sample(analyser, buf)) return 0;
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

function rmsOf(analyser: AnalyserNode, buf: Float32Array): number {
  if (!sample(analyser, buf)) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

// The instantaneous value (first sample of the window) — snapshot~ semantics.
function instantOf(analyser: AnalyserNode, buf: Float32Array): number {
  if (!sample(analyser, buf)) return 0;
  return buf[0];
}

// ── meter~ : peak level meter ────────────────────────────────────────────────
// 1 signal inlet, 1 control outlet. Reports the peak amplitude (0..1) at a fixed
// display interval while the transport runs.
register('meter~', (_args, { ctx }) => {
  const analyser = new AnalyserNode(ctx, { fftSize: 2048 });
  const buf = new Float32Array(BUF);
  const o = makeOutlets();
  const cancel = scheduler.everyMs(250, () => o.emit(0, [peakOf(analyser, buf)]));
  return {
    signalIns: [analyser],
    signalOuts: [undefined], // outlet 0 is control, not signal
    onControlOut: o.onControlOut,
    dispose: () => cancel(),
  } satisfies MaxNode;
});

// ── snapshot~ : sample-on-demand / periodic ──────────────────────────────────
// inlets [signal(+bang to sample), report-interval(ms)]; 1 control outlet.
// A bang samples the signal once; a non-zero interval arg/right-inlet reports
// periodically via the scheduler.
register('snapshot~', (args, { ctx }) => {
  const analyser = new AnalyserNode(ctx, { fftSize: 2048 });
  const buf = new Float32Array(BUF);
  const o = makeOutlets();
  let intervalMs = Math.max(0, num(args[0], 0));
  let cancel: (() => void) | null = null;

  const report = () => o.emit(0, [instantOf(analyser, buf)]);
  const rearm = () => {
    cancel?.();
    cancel = intervalMs > 0 ? scheduler.everyMs(intervalMs, report) : null;
  };
  rearm();

  return {
    signalIns: [analyser, undefined],
    signalOuts: [undefined], // outlet 0 is control
    controlIns: [
      (m: Msg) => { if (isBang(m) || firstNum(m) !== undefined) report(); }, // bang samples now
      (m: Msg) => { const n = firstNum(m); if (n !== undefined) { intervalMs = Math.max(0, n); rearm(); } },
    ],
    onControlOut: o.onControlOut,
    dispose: () => { cancel?.(); cancel = null; },
  } satisfies MaxNode;
});

// ── avg~ : average (RMS) magnitude on bang ────────────────────────────────────
// 1 signal inlet (also accepts a bang), 1 control outlet. On bang, reports the
// average magnitude of the signal window. (Max averages |x|; RMS is close enough
// and cheaper to reason about for the prototype.)
register('avg~', (_args, { ctx }) => {
  const analyser = new AnalyserNode(ctx, { fftSize: 2048 });
  const buf = new Float32Array(BUF);
  const o = makeOutlets();
  return {
    signalIns: [analyser],
    signalOuts: [undefined], // outlet 0 is control
    controlIns: [(_m: Msg) => o.emit(0, [rmsOf(analyser, buf)])], // any msg/bang reports
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── peakamp~ : peak since last report ─────────────────────────────────────────
// inlets [signal(+bang), ms-output-interval]; 1 control outlet. Tracks the running
// peak; a bang (or each periodic tick) emits it and resets the accumulator.
register('peakamp~', (args, { ctx }) => {
  const analyser = new AnalyserNode(ctx, { fftSize: 2048 });
  const buf = new Float32Array(BUF);
  const o = makeOutlets();
  let running = 0;
  let intervalMs = Math.max(0, num(args[0], 0));
  let cancel: (() => void) | null = null;

  const accumulate = () => { const p = peakOf(analyser, buf); if (p > running) running = p; };
  const report = () => { accumulate(); o.emit(0, [running]); running = 0; };
  const rearm = () => {
    cancel?.();
    cancel = intervalMs > 0 ? scheduler.everyMs(intervalMs, report) : null;
  };
  rearm();

  return {
    signalIns: [analyser, undefined],
    signalOuts: [undefined], // outlet 0 is control
    controlIns: [
      (m: Msg) => { if (isBang(m) || firstNum(m) !== undefined) report(); }, // bang reports peak
      (m: Msg) => { const n = firstNum(m); if (n !== undefined) { intervalMs = Math.max(0, n); rearm(); } },
    ],
    onControlOut: o.onControlOut,
    dispose: () => { cancel?.(); cancel = null; },
  } satisfies MaxNode;
});

// ── number~ : signal number box ──────────────────────────────────────────────
// inlets [signal, set-value(control)]; outlets [signal(pass-through), control].
// The signal passes straight through outlet 0; the current value is tapped and
// emitted on control outlet 1 at a display interval. A float into inlet 1 sets and
// reports the value immediately (Max's "output value" behaviour, simplified).
register('number~', (_args, { ctx }) => {
  const pass = new GainNode(ctx, { gain: 1 });
  const analyser = new AnalyserNode(ctx, { fftSize: 2048 });
  pass.connect(analyser); // analyser is a side-tap; it does not alter the pass-through
  const buf = new Float32Array(BUF);
  const o = makeOutlets();
  const cancel = scheduler.everyMs(100, () => o.emit(1, [instantOf(analyser, buf)]));
  return {
    signalIns: [pass, undefined],
    signalOuts: [pass, undefined], // outlet 0 signal, outlet 1 control
    controlIns: [
      undefined,
      (m: Msg) => { const n = firstNum(m); if (n !== undefined) o.emit(1, [n]); },
    ],
    onControlOut: o.onControlOut,
    dispose: () => cancel(),
  } satisfies MaxNode;
});

// ── thresh~ : signal Schmitt gate ─────────────────────────────────────────────
// inlets [signal, low/reset-threshold, high/set-threshold]; 1 signal outlet.
// Emits 1.0 when the input rises past the high threshold and 0.0 below the low
// threshold. NOTE: true hysteresis is stateful and needs an AudioWorklet; a
// stateless WaveShaper can't remember which side it was on, so we approximate with
// a single trip point at the midpoint of [low, high] (the classic non-hysteretic
// comparator). Faithful hysteresis is a browser-mode follow-up.
register('thresh~', (args, { ctx }) => {
  let low = num(args[0], 0);
  let high = num(args[1], 0);
  const shaper = new WaveShaperNode(ctx);

  const rebuild = () => {
    const trip = (low + high) / 2;
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1; // -1..1 input range
      curve[i] = x >= trip ? 1 : 0;
    }
    shaper.curve = curve;
  };
  rebuild();

  return {
    signalIns: [shaper, undefined, undefined],
    signalOuts: [shaper],
    controlIns: [
      undefined,
      (m: Msg) => { const n = firstNum(m); if (n !== undefined) { low = n; rebuild(); } },
      (m: Msg) => { const n = firstNum(m); if (n !== undefined) { high = n; rebuild(); } },
    ],
  } satisfies MaxNode;
});

// ── edge~ : zero-crossing edge detector ───────────────────────────────────────
// 1 signal inlet, 2 control outlets [rising(0->nonzero), falling(nonzero->0)].
// NOTE: sample-accurate edge detection needs an AudioWorklet; here we poll the
// signal on the transport clock and bang when the polled level crosses zero
// between ticks — good for gate-rate signals, coarse for audio-rate ones.
register('edge~', (_args, { ctx }) => {
  const analyser = new AnalyserNode(ctx, { fftSize: 2048 });
  const buf = new Float32Array(BUF);
  const o = makeOutlets();
  let wasOn = false;
  const cancel = scheduler.everyMs(1, () => {
    const on = peakOf(analyser, buf) > 0;
    if (on && !wasOn) o.emit(0, BANG);      // rising edge
    else if (!on && wasOn) o.emit(1, BANG); // falling edge
    wasOn = on;
  });
  return {
    signalIns: [analyser],
    signalOuts: [undefined, undefined], // both outlets are control
    onControlOut: o.onControlOut,
    dispose: () => cancel(),
  } satisfies MaxNode;
});
