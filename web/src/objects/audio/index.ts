// Audio (MSP) objects — the signal domain. Each maps a Max ~ object to Web Audio
// nodes. Registering this module's side effects populates the global registry.
//
// Fidelity notes are inline. The goal for the prototype is "recognisably correct
// sound", not sample-accurate parity with Max's DSP.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';

// cycle~ : sine oscillator. inlet 0 sets frequency (signal or float), outlet 0 is audio.
register('cycle~', (args, { ctx }) => {
  const osc = new OscillatorNode(ctx, { type: 'sine', frequency: num(args[0], 440) });
  osc.start();
  return {
    signalIns: [osc.frequency],
    signalOuts: [osc],
    controlIns: [(m) => { const n = firstNum(m); if (n !== undefined) osc.frequency.value = n; }],
  } satisfies MaxNode;
});

// phasor~ : 0..1 rising ramp. Approximated as a sawtooth scaled/offset to 0..1
// (Web Audio 'sawtooth' runs -1..1). Good enough for the classic phasor->wave math.
register('phasor~', (args, { ctx }) => {
  const saw = new OscillatorNode(ctx, { type: 'sawtooth', frequency: num(args[0], 0) });
  const half = new GainNode(ctx, { gain: 0.5 });      // -0.5..0.5
  const offset = new ConstantSourceNode(ctx, { offset: 0.5 }); // -> 0..1
  saw.connect(half);
  offset.connect(half); // ConstantSource sums into half's input
  saw.start();
  offset.start();
  return {
    signalIns: [saw.frequency],
    signalOuts: [half],
    controlIns: [(m) => { const n = firstNum(m); if (n !== undefined) saw.frequency.value = n; }],
  } satisfies MaxNode;
});

// *~ : signal multiply. arg or right-inlet signal is the multiplier.
register('*~', (args, { ctx }) => {
  const gain = new GainNode(ctx, { gain: num(args[0], 1) });
  return {
    signalIns: [gain, gain.gain], // inlet 0 = audio in, inlet 1 = multiplier
    signalOuts: [gain],
    controlIns: [undefined, (m) => { const n = firstNum(m); if (n !== undefined) gain.gain.value = n; }],
  } satisfies MaxNode;
});

// +~ / -~ : signal add / subtract of a constant (or right-inlet signal).
// Web Audio has no add node, so a ConstantSource sums into a pass-through gain.
function makeAdder(sign: 1 | -1) {
  return (args: (number | string)[], { ctx }: { ctx: BaseAudioContext }): MaxNode => {
    const pass = new GainNode(ctx, { gain: 1 });
    const offset = new ConstantSourceNode(ctx, { offset: sign * num(args[0], 0) });
    offset.connect(pass);
    offset.start();
    return {
      signalIns: [pass, offset.offset],
      signalOuts: [pass],
      controlIns: [undefined, (m) => { const n = firstNum(m); if (n !== undefined) offset.offset.value = sign * n; }],
    };
  };
}
register('+~', makeAdder(1));
register('-~', makeAdder(-1));

// gain~ : slider-controlled amp. Outlet 0 is the scaled signal; outlet 1 emits the
// raw slider value (control). Prototype: fixed pass-through gain, no UI slider yet,
// so the control outlet exists but stays quiet until the widget lands.
register('gain~', (_args, { ctx }) => {
  const gain = new GainNode(ctx, { gain: 1 });
  const o = makeOutlets();
  return {
    signalIns: [gain],
    signalOuts: [gain, undefined], // outlet 1 is control, not signal
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// clip~ : hard-clip signal to [lo, hi] (default -1..1) via a WaveShaper.
register('clip~', (args, { ctx }) => {
  const lo = num(args[0], -1);
  const hi = num(args[1], 1);
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1; // -1..1 input range
    curve[i] = Math.max(lo, Math.min(hi, x));
  }
  const shaper = new WaveShaperNode(ctx, { curve });
  return { signalIns: [shaper], signalOuts: [shaper] } satisfies MaxNode;
});

// lores~ : resonant lowpass. Maps to a biquad lowpass (cutoff, resonance args).
register('lores~', (args, { ctx }) => {
  const filter = new BiquadFilterNode(ctx, {
    type: 'lowpass',
    frequency: num(args[0], 1000),
    Q: num(args[1], 1),
  });
  return {
    signalIns: [filter, filter.frequency, filter.Q],
    signalOuts: [filter],
    // inlet 1/2 also accept control floats (cutoff / resonance), so a dial or
    // number box can sweep the filter, not just a signal.
    controlIns: [
      undefined,
      (m) => { const n = firstNum(m); if (n !== undefined) filter.frequency.value = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) filter.Q.value = n; },
    ],
  } satisfies MaxNode;
});

// ezdac~ : stereo output. inlets 0/1 -> left/right of the destination.
// Audio only flows once the AudioContext is running (the Start button resumes it).
register('ezdac~', (_args, { ctx }) => {
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  merger.connect(ctx.destination);
  // Both inlets accept mono signals; route each to its channel.
  const left = new GainNode(ctx, { gain: 1 });
  const right = new GainNode(ctx, { gain: 1 });
  left.connect(merger, 0, 0);
  right.connect(merger, 0, 1);
  return { signalIns: [left, right], signalOuts: [] } satisfies MaxNode;
});
