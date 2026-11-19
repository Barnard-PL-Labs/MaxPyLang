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
import { firstNum, type Msg } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';
import { PROCESSORS, tryWorkletNode } from '../../runtime/worklet';

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

// tapin~ / tapout~ : a delay line and the taps that read it.
//
// In Max the two are joined by a cord: tapin~'s outlet carries a `tapconnect` message
// and every tapout~ it reaches reads that tapin~'s line. Here the cord does the same job.
// A tapin~ keeps its input under a token, and announces the token to each cord as the
// cord is made; a tapout~ that hears it builds its own DelayNode off that input.
//
// Each tap owning a DelayNode is what lets one tapin~ feed taps at different times, and
// lets two tapin~ / tapout~ pairs (a stereo delay) coexist. An earlier version shared
// one DelayNode through a module-level "most recent tapin~" variable, so the second
// pair in a patch silently read the first pair's line.
//
// Feedback (tapout~ -> *~ -> tapin~) is legal for the reason it is in Max: the cycle
// contains a delay. A cycle costs one extra render quantum in the browser (128 samples,
// about 3 ms, measured in Chrome as every repeat arriving that much late while the first
// echo is on time). So each tap has a second, "early" read of the line, one quantum
// shorter, and the engine wires the cords that go back round the loop from that one
// (MaxNode.loopOuts). The repeats then land where Max has them. A delay inside a cycle
// cannot be shorter than a quantum, so a loop under about 6 ms stays too long.

interface TapLine { input: GainNode; maxSeconds: number }
const tapLines = new Map<string, TapLine>();
let tapSerial = 0;

// tapin~ : the write end. inlet 0 = audio in. outlet 0 = the tap link. arg 0 = line
// length (ms).
register('tapin~', (args, { ctx }) => {
  const maxSeconds = clampMax(num(args[0], 1000) / 1000);
  const input = new GainNode(ctx, { gain: 1 });
  const token = `tap-${++tapSerial}`;
  tapLines.set(token, { input, maxSeconds });
  const o = makeOutlets();
  return {
    signalIns: [input],
    signalOuts: [undefined], // the outlet is a tap link, not a signal
    onControlOut(outlet, cb) {
      const off = o.onControlOut(outlet, cb);
      if (outlet === 0) cb(['tapconnect', token]);
      return off;
    },
    dispose: () => {
      tapLines.delete(token);
      try { input.disconnect(); } catch { /* nothing connected */ }
    },
  } satisfies MaxNode;
});

// tapout~ : the read end. One inlet and one outlet per argument; each argument is that
// tap's delay time in ms. An inlet takes the tap link, a float (the time in ms) or a
// signal (the time in ms, continuously, which is how a chorus sweeps it).
register('tapout~', (args, { ctx }) => {
  const count = Math.max(1, args.length);
  const quantum = 128 / ctx.sampleRate;
  const outs: GainNode[] = [];
  const earlyOuts: GainNode[] = [];
  const timeIns: GainNode[] = [];
  const delays: (DelayNode | undefined)[] = [];
  const earlies: (DelayNode | undefined)[] = [];
  const times: number[] = [];
  let line: TapLine | undefined;
  // What the early read of each tap is shortened by.
  const trim = new ConstantSourceNode(ctx, { offset: -quantum });
  trim.start();

  for (let i = 0; i < count; i++) {
    outs[i] = new GainNode(ctx, { gain: 1 });
    earlyOuts[i] = new GainNode(ctx, { gain: 1 });
    // A signal at the inlet is a time in ms; DelayNode.delayTime wants seconds.
    timeIns[i] = new GainNode(ctx, { gain: 0.001 });
    times[i] = Math.max(0, num(args[i], 0)) / 1000;
  }

  const cut = (delay: DelayNode | undefined, i: number): void => {
    if (!delay) return;
    try { line?.input.disconnect(delay); } catch { /* already cut */ }
    try { timeIns[i].disconnect(delay.delayTime); } catch { /* already cut */ }
    try { delay.disconnect(); } catch { /* already cut */ }
  };

  const attach = (next: TapLine): void => {
    for (let i = 0; i < count; i++) {
      cut(delays[i], i);
      cut(earlies[i], i);
      const make = (): DelayNode => {
        const delay = new DelayNode(ctx, {
          maxDelayTime: next.maxSeconds,
          delayTime: Math.min(times[i], next.maxSeconds),
        });
        next.input.connect(delay);
        timeIns[i].connect(delay.delayTime);
        return delay;
      };
      const delay = make();
      delay.connect(outs[i]);
      delays[i] = delay;
      const early = make();
      trim.connect(early.delayTime);
      early.connect(earlyOuts[i]);
      earlies[i] = early;
    }
    line = next;
  };

  const setTime = (i: number, ms: number): void => {
    times[i] = Math.max(0, ms) / 1000;
    const target = Math.min(times[i], line?.maxSeconds ?? times[i]);
    for (const delay of [delays[i], earlies[i]]) {
      if (!delay) continue;
      // Glide instead of jumping: a jump in delay time is a click, a glide is the pitch
      // bend a real delay line makes when its time knob is turned.
      delay.delayTime.cancelScheduledValues(ctx.currentTime);
      delay.delayTime.setTargetAtTime(target, ctx.currentTime, 0.03);
    }
  };

  const controlIns = timeIns.map((_, i) => (m: Msg) => {
    if (m[0] === 'tapconnect') {
      const next = tapLines.get(String(m[1]));
      if (next) attach(next);
      return;
    }
    const n = firstNum(m);
    if (n !== undefined) setTime(i, n);
  });

  return {
    signalIns: timeIns,
    signalOuts: outs,
    loopOuts: earlyOuts,
    controlIns,
    dispose: () => {
      try { trim.stop(); trim.disconnect(); } catch { /* already stopped */ }
      for (let i = 0; i < count; i++) {
        cut(delays[i], i);
        cut(earlies[i], i);
        try { timeIns[i].disconnect(); } catch { /* already cut */ }
        try { outs[i].disconnect(); } catch { /* already cut */ }
        try { earlyOuts[i].disconnect(); } catch { /* already cut */ }
      }
    },
  } satisfies MaxNode;
});

// comb~ : comb filter = delay line with feedforward + feedback taps.
//   y(n) = a*x(n) + b*x(n-D) + c*y(n-D)
// Inlets: 0 audio in, 1 delay time (ms), 2 gain (a), 3 feedforward (b), 4 feedback (c).
// arg 0 = max delay (ms, 10 if not given), 1 = initial delay (ms), 2 = a, 3 = b, 4 = c.
//
// The real thing is a worklet running that recurrence, matched to Max 9: the feedback
// repeats land on the same sample as in Max (a delay set by a number is cut down to whole
// samples), and a delay driven by a signal is read between samples.
//
// Without a worklet it is a DelayNode with a feedback gain into its own input. That is
// the right shape, but a cycle costs the browser one extra render quantum, so the loop
// runs 128 samples long: a reverb built on it comes out detuned.
register('comb~', (args, { ctx }) => {
  const maxMs = num(args[0], 10);
  const node = tryWorkletNode(ctx, PROCESSORS.comb, { numberOfInputs: 2, processorOptions: { maxDelayMs: maxMs } });
  if (node) {
    const names = ['delay', 'a', 'b', 'c'] as const;
    const params = names.map((n) => node.parameters.get(n));
    params.forEach((p, i) => { if (p) p.value = num(args[i + 1], 0); });
    // A delay time arriving as a signal goes to the worklet's second input, not to the
    // param: that is how the worklet can tell a swept delay (read between samples, as in
    // Max) from one set by a number (whole samples), even when the signal holds still.
    const sweep = new GainNode(ctx, { gain: 1 });
    sweep.connect(node, 0, 1);
    return {
      signalIns: [node, sweep, ...params.slice(1).map((p) => p ?? undefined)],
      signalOuts: [node],
      controlIns: [
        undefined,
        ...params.map((p) => (m: Msg) => { const n = firstNum(m); if (n !== undefined && p) p.value = n; }),
      ],
      dispose: () => {
        try { sweep.disconnect(); } catch { /* nothing connected */ }
        try { node.disconnect(); } catch { /* nothing connected */ }
      },
    } satisfies MaxNode;
  }

  const maxDelayTime = clampMax(maxMs / 1000); // ms -> seconds
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
