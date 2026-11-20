// Envelope / ramp MSP objects — the "env" batch. Each maps a Max ~ ramp/envelope
// object to Web Audio automation. The workhorse is a ConstantSourceNode whose
// .offset is scheduled with linearRampToValueAtTime / setTargetAtTime, plus a
// scheduler timer to emit the "done" control bang some objects report.
//
// Fidelity notes are inline. The goal is "recognisably correct" ramp behaviour,
// not sample-accurate parity with Max's DSP. Anything that needs a per-sample
// AudioWorklet to be faithful (rampsmooth~) is left stubbed, not faked.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum, nums, BANG, type Msg } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';
import { scheduler } from '../../runtime/scheduler';
import { stopSource } from './lifecycle';

// line~ : signal ramp generator. inlet 0 takes `target` (jump) or `target time`
// (ramp over `time` ms); optional list of pairs uses the first pair here. Outlet 0
// is the ramping signal; outlet 1 (control) bangs when a ramp finishes.
register('line~', (args, { ctx }) => {
  const initial = num(args[0], 0);
  const src = new ConstantSourceNode(ctx, { offset: initial });
  src.start();
  const o = makeOutlets();
  let cancelDone: (() => void) | undefined;

  const clearDone = () => { cancelDone?.(); cancelDone = undefined; };

  // A message is one or more target-time pairs, run one after another, as in Max:
  // "0 0 1500 1500" jumps to 0, then ramps to 1500 over 1.5 s. A lone number jumps.
  const ramp = (m: Msg) => {
    const vals = nums(m);
    if (vals.length === 0) return;
    clearDone();
    const now = ctx.currentTime;
    src.offset.cancelScheduledValues(now);
    src.offset.setValueAtTime(src.offset.value, now);
    let at = now;
    let totalMs = 0;
    for (let i = 0; i < vals.length; i += 2) {
      const target = vals[i];
      const timeMs = Math.max(0, vals[i + 1] ?? 0);
      if (timeMs === 0) src.offset.setValueAtTime(target, at);
      else src.offset.linearRampToValueAtTime(target, at + timeMs / 1000);
      at += timeMs / 1000;
      totalMs += timeMs;
    }
    if (totalMs <= 0) o.emit(1, BANG); // instantaneous jump reports done immediately
    else cancelDone = scheduler.afterMs(totalMs, () => { cancelDone = undefined; o.emit(1, BANG); });
  };

  return {
    signalIns: [undefined, undefined], // both inlets are message inlets
    signalOuts: [src, undefined],       // outlet 1 is control, not signal
    controlIns: [ramp, undefined],
    onControlOut: o.onControlOut,
    dispose: () => { clearDone(); stopSource(src); },
  } satisfies MaxNode;
});

// curve~ : like line~ but ramps along an exponential-ish curve. inlet 0 takes
// `target` / `target time`; inlet 2 sets the curve parameter. Web Audio's
// setTargetAtTime gives the natural exponential approach; the curve parameter
// scales its time-constant. Outlet 0 signal, outlet 1 (control) done-bang.
register('curve~', (args, { ctx }) => {
  const initial = num(args[0], 0);
  let curveParam = num(args[1], 0);
  const src = new ConstantSourceNode(ctx, { offset: initial });
  src.start();
  const o = makeOutlets();
  let cancelDone: (() => void) | undefined;
  const clearDone = () => { cancelDone?.(); cancelDone = undefined; };

  // A message is target-time-curve triples, run one after another, as in Max: "1 5 0
  // 0 800 0.8" rises to 1 in 5 ms, then falls to 0 over 800 ms with a curve of 0.8. Two
  // numbers are one segment with the curve from the right inlet. Each segment bends the
  // approach (curve > 0 slower start, < 0 faster), then lands exactly on its target.
  const ramp = (m: Msg) => {
    const vals = nums(m);
    if (vals.length === 0) return;
    const segments: [number, number, number][] = [];
    if (vals.length <= 2) segments.push([vals[0], vals[1] ?? 0, curveParam]);
    else for (let i = 0; i < vals.length; i += 3) segments.push([vals[i], vals[i + 1] ?? 0, vals[i + 2] ?? curveParam]);
    clearDone();
    const now = ctx.currentTime;
    src.offset.cancelScheduledValues(now);
    src.offset.setValueAtTime(src.offset.value, now);
    let at = now;
    let totalMs = 0;
    for (const [target, rawMs, curve] of segments) {
      const timeMs = Math.max(0, rawMs);
      if (timeMs === 0) {
        src.offset.setValueAtTime(target, at);
        continue;
      }
      const bend = Math.min(0.9, Math.max(0.05, 0.3 + curve * 0.2));
      src.offset.setTargetAtTime(target, at, (timeMs / 1000) * bend);
      src.offset.linearRampToValueAtTime(target, at + timeMs / 1000);
      at += timeMs / 1000;
      totalMs += timeMs;
    }
    if (totalMs <= 0) o.emit(1, BANG);
    else cancelDone = scheduler.afterMs(totalMs, () => { cancelDone = undefined; o.emit(1, BANG); });
  };

  return {
    signalIns: [undefined, undefined, undefined],
    signalOuts: [src, undefined],
    controlIns: [
      ramp,
      undefined,
      (m) => { const n = firstNum(m); if (n !== undefined) curveParam = n; },
    ],
    onControlOut: o.onControlOut,
    dispose: () => { clearDone(); stopSource(src); },
  } satisfies MaxNode;
});

// adsr~ : attack/decay/sustain/release envelope. inlet 0 is the gate (nonzero =
// note on -> attack then decay to sustain; 0 = note off -> release to 0). inlets
// 1..4 set A/D/S/R. Outlet 0 is the envelope signal, outlet 1 mirrors it (a
// second signal tap), outlets 2/3 (control) bang at end-of-attack-phase and
// end-of-release respectively.
register('adsr~', (args, { ctx }) => {
  let attack = num(args[0], 0);
  let decay = num(args[1], 0);
  let sustain = num(args[2], 1);
  let release = num(args[3], 0);

  const env = new ConstantSourceNode(ctx, { offset: 0 });
  env.start();
  const tap = new GainNode(ctx, { gain: 1 }); // outlet 1: a second signal tap
  env.connect(tap);
  const o = makeOutlets();
  let cancelAttackDone: (() => void) | undefined;
  let cancelReleaseDone: (() => void) | undefined;
  const clearTimers = () => {
    cancelAttackDone?.(); cancelAttackDone = undefined;
    cancelReleaseDone?.(); cancelReleaseDone = undefined;
  };

  const gate = (m: Msg) => {
    const on = firstNum(m);
    if (on === undefined) return;
    const now = ctx.currentTime;
    clearTimers();
    env.offset.cancelScheduledValues(now);
    env.offset.setValueAtTime(env.offset.value, now);
    if (on !== 0) {
      // attack to peak (1), then decay to sustain level.
      const aEnd = now + attack / 1000;
      env.offset.linearRampToValueAtTime(1, aEnd);
      env.offset.linearRampToValueAtTime(sustain, aEnd + decay / 1000);
      cancelAttackDone = scheduler.afterMs(attack + decay, () => {
        cancelAttackDone = undefined; o.emit(2, BANG);
      });
    } else {
      env.offset.linearRampToValueAtTime(0, now + release / 1000);
      cancelReleaseDone = scheduler.afterMs(release, () => {
        cancelReleaseDone = undefined; o.emit(3, BANG);
      });
    }
  };

  const setNum = (set: (n: number) => void) => (m: Msg) => {
    const n = firstNum(m); if (n !== undefined) set(n);
  };

  return {
    signalIns: [undefined, undefined, undefined, undefined, undefined],
    signalOuts: [env, tap, undefined, undefined],
    controlIns: [
      gate,
      setNum((n) => { attack = n; }),
      setNum((n) => { decay = n; }),
      setNum((n) => { sustain = n; }),
      setNum((n) => { release = n; }),
    ],
    onControlOut: o.onControlOut,
    dispose: () => { clearTimers(); stopSource(env); },
  } satisfies MaxNode;
});

// trapezoid~ : maps an incoming 0..1 ramp (e.g. from phasor~) through a
// trapezoidal window — rises over `ramp-up`, holds at 1, falls over `ramp-down`.
// A WaveShaper transfer function implements this directly. inlets 1/2 set the
// ramp fractions and rebuild the curve. Single signal outlet.
register('trapezoid~', (args, { ctx }) => {
  let rampUp = num(args[0], 0.1);
  let rampDown = num(args[1], 0.1);
  const shaper = new WaveShaperNode(ctx);

  const rebuild = () => {
    const N = 1024;
    const curve = new Float32Array(N);
    const up = Math.min(Math.max(rampUp, 0), 0.5);
    const down = Math.min(Math.max(rampDown, 0), 0.5);
    const hiStart = up;
    const hiEnd = 1 - down;
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1; // WaveShaper input range -1..1
      const p = Math.min(Math.max(x, 0), 1); // meaningful phase 0..1
      let y: number;
      if (p < hiStart) y = up > 0 ? p / up : 1;
      else if (p > hiEnd) y = down > 0 ? (1 - p) / down : 1;
      else y = 1;
      curve[i] = y;
    }
    shaper.curve = curve;
  };
  rebuild();

  const setNum = (set: (n: number) => void) => (m: Msg) => {
    const n = firstNum(m); if (n !== undefined) { set(n); rebuild(); }
  };

  return {
    signalIns: [shaper, undefined, undefined],
    signalOuts: [shaper],
    controlIns: [
      undefined,
      setNum((n) => { rampUp = n; }),
      setNum((n) => { rampDown = n; }),
    ],
  } satisfies MaxNode;
});

// NOTE: rampsmooth~ is intentionally NOT implemented here — see the "skipped"
// report. Faithfully smoothing an arbitrary signal input over a sample-count
// ramp is a per-sample one-pole/linear slew that has no direct Web Audio node;
// it needs a custom AudioWorklet. It stays a Tier-A stub rather than a fake.
