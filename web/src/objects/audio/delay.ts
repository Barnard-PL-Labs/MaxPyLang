// Audio (MSP) delay objects — the "delay" batch. Each maps a Max ~ object onto a
// Web Audio DelayNode. Registering this module's side effects populates the global
// registry (import it for its effect, like the other audio object modules).
//
// Fidelity notes are inline. The goal for the prototype is "recognisably correct
// sound", not sample-accurate parity with Max's DSP.
//
// Unit conventions (Web Audio DelayNode.delayTime is in SECONDS):
//   • delay~            : Max measures its delay in SAMPLES  -> seconds = samples / sr
//   • tapin~ / tapout~  : Max measures the tap in MILLISECONDS -> seconds = ms / 1000
//   • comb~             : Max measures its delay in MILLISECONDS -> seconds = ms / 1000

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';

// DelayNode.maxDelayTime must be finite, > 0 and (per spec) < 180s.
function clampMax(sec: number): number {
  if (!Number.isFinite(sec) || sec <= 0) return 1;
  return Math.min(sec, 179);
}

// delay~ : signal delay line. inlet 0 = audio in, inlet 1 = delay time (signal/float).
// arg 0 = maximum delay memory (samples), arg 1 = initial delay time (samples).
register('delay~', (args, { ctx }) => {
  const sr = ctx.sampleRate || 44100;
  const maxDelayTime = clampMax(num(args[0], sr) / sr); // samples -> seconds
  const initDelay = Math.min(num(args[1], 0) / sr, maxDelayTime);
  const delay = new DelayNode(ctx, { maxDelayTime, delayTime: initDelay });
  return {
    signalIns: [delay, delay.delayTime], // inlet 0 = audio, inlet 1 = delay time
    signalOuts: [delay],
    controlIns: [
      undefined,
      (m) => { const n = firstNum(m); if (n !== undefined) delay.delayTime.value = n / sr; },
    ],
  } satisfies MaxNode;
});

// tapin~ / tapout~ share a delay line. tapin~ writes the incoming signal into a
// DelayNode; tapout~ reads it back out at a tap time. In Max they're joined by a
// special cord (a control-domain outlet on tapin~ -> tapout~'s inlet); here they
// share the delay line through a module-local reference to the most recent tapin~.
let sharedDelay: DelayNode | undefined;
let sharedMax = 1; // seconds — max delay of the shared line (kept as a plain number,
// since DelayNode.maxDelayTime is a read-only attribute, not an AudioParam).

// tapin~ : the write end. inlet 0 = audio in. outlet 0 is a CONTROL tap link
// (never carries a Msg here — the sharing is done via the shared DelayNode).
// arg 0 = maximum delay (ms).
register('tapin~', (args, { ctx }) => {
  const maxDelayTime = clampMax(num(args[0], 1000) / 1000); // ms -> seconds
  const delay = new DelayNode(ctx, { maxDelayTime, delayTime: 0 });
  sharedDelay = delay;
  sharedMax = maxDelayTime;
  const o = makeOutlets();
  return {
    signalIns: [delay],          // inlet 0 = audio into the delay line
    signalOuts: [undefined],     // outlet 0 is a control tap link, not signal
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// tapout~ : the read end. Reads the shared delay line at a tap time. inlet 0
// receives the tapin~ link and also sets the tap time (float, ms). outlet 0 =
// delayed signal. arg 0 = initial delay (ms).
register('tapout~', (args, { ctx }) => {
  // Reuse the most recent tapin~'s delay line; fall back to a fresh line so a
  // lone tapout~ still builds and is audible.
  const delay = sharedDelay ?? new DelayNode(ctx, { maxDelayTime: 1, delayTime: 0 });
  const max = sharedDelay ? sharedMax : 1;
  const tap = Math.min(num(args[0], 0) / 1000, max); // ms -> seconds
  delay.delayTime.value = tap;
  return {
    signalIns: [delay.delayTime], // inlet 0 sets the tap time
    signalOuts: [delay],          // outlet 0 = delayed signal
    controlIns: [
      (m) => {
        const n = firstNum(m);
        if (n !== undefined) delay.delayTime.value = Math.min(n / 1000, max);
      },
    ],
  } satisfies MaxNode;
});

// comb~ : comb filter = delay line with feedforward + feedback taps.
//   y(n) = a*x(n) + b*x(n-D) + c*y(n-D)
// Realised as a single DelayNode with a feedback gain into its own input, a
// feedforward gain on the delayed tap, and a direct gain, summed at the output.
// Inlets: 0 audio in, 1 delay time (ms), 2 gain (a), 3 feedforward (b), 4 feedback (c).
// arg 0 = max delay (ms), 1 = initial delay (ms), 2 = a, 3 = b, 4 = c.
register('comb~', (args, { ctx }) => {
  const maxDelayTime = clampMax(num(args[0], 100) / 1000); // ms -> seconds
  const initDelay = Math.min(num(args[1], 0) / 1000, maxDelayTime);

  const input = new GainNode(ctx, { gain: 1 });
  const delay = new DelayNode(ctx, { maxDelayTime, delayTime: initDelay });
  const direct = new GainNode(ctx, { gain: num(args[2], 0) });     // a
  const feedfwd = new GainNode(ctx, { gain: num(args[3], 0) });    // b
  const feedback = new GainNode(ctx, { gain: num(args[4], 0) });   // c
  const out = new GainNode(ctx, { gain: 1 });

  input.connect(direct).connect(out);   // a * x(n)
  input.connect(delay);
  delay.connect(feedfwd).connect(out);  // b * x(n-D)
  delay.connect(feedback).connect(delay); // c * y(n-D) fed back into the line

  return {
    signalIns: [input, delay.delayTime, direct.gain, feedfwd.gain, feedback.gain],
    signalOuts: [out],
    controlIns: [
      undefined,
      (m) => { const n = firstNum(m); if (n !== undefined) delay.delayTime.value = Math.min(n / 1000, maxDelayTime); },
      (m) => { const n = firstNum(m); if (n !== undefined) direct.gain.value = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) feedfwd.gain.value = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) feedback.gain.value = n; },
    ],
  } satisfies MaxNode;
});
