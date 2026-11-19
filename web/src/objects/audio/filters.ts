// Audio (MSP) filter objects — the "filters" batch. Each maps a Max ~ filter to
// Web Audio nodes. Importing this module for its side effects registers the
// factories in the global registry.
//
// Fidelity notes are inline. The goal for the prototype is "recognisably correct
// sound", not sample-accurate parity with Max's DSP. True acoustic response is
// verified later in browser mode; here we only guarantee correct I/O wiring.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum } from '../../runtime/atoms';
import { PROCESSORS, tryWorkletNode } from '../../runtime/worklet';

// Max takes filter cutoffs up to a quarter of the sample rate (svf~ and onepole~ both
// document it), so a dial that goes higher does nothing more in Live. Mirror that.
const quarterRate = (ctx: BaseAudioContext, hz: number): number => Math.max(0, Math.min(ctx.sampleRate / 4, hz));

// onepole~ : one-pole lowpass, 6 dB per octave. inlet 0 signal, inlet 1 the cutoff (Hz).
// The real thing is a worklet running Max's own recurrence. Without one (Node, or a
// context nobody preloaded) a lowpass biquad stands in: right cutoff, steeper slope.
// The mode symbol arg (Hz/linear/radians) is accepted but ignored; the value is Hz.
register('onepole~', (args, { ctx }) => {
  const node = tryWorkletNode(ctx, PROCESSORS.onepole);
  const pFreq = node?.parameters.get('freq');
  if (node && pFreq) {
    pFreq.value = quarterRate(ctx, num(args[0], 100));
    return {
      signalIns: [node, pFreq],
      signalOuts: [node],
      controlIns: [
        undefined,
        (m) => { const n = firstNum(m); if (n !== undefined) pFreq.value = quarterRate(ctx, n); },
      ],
      dispose: () => { try { node.disconnect(); } catch { /* nothing connected */ } },
    } satisfies MaxNode;
  }
  const filter = new BiquadFilterNode(ctx, {
    type: 'lowpass',
    frequency: num(args[0], 100),
  });
  return {
    signalIns: [filter, filter.frequency],
    signalOuts: [filter],
    controlIns: [
      undefined,
      (m) => { const n = firstNum(m); if (n !== undefined) filter.frequency.value = n; },
    ],
  } satisfies MaxNode;
});

// svf~ : state-variable filter. One input, four simultaneous outputs (lowpass,
// highpass, bandpass, notch). inlet 1 = center frequency, inlet 2 = resonance.
//
// Max's resonance runs 0..1 and is not a Q. Rendering svf~ in Max 9 shows the quality
// factor is 1 / (1.2 * (1 - resonance))^2, never below 1: flat up to about 0.17, 2.8 at
// 0.5, 67 at 0.9. The worklet runs the recurrence fitted to those recordings sample for
// sample, so all four outputs come out at Max's levels (the bandpass peaks at that same
// gain, it is not normalised to 1).
//
// Without a worklet, four biquads of the matching type stand in, with the resonance
// mapped to the same quality factor: linear for bandpass and notch, decibels for lowpass
// and highpass. Their bandpass is normalised, so it reads quieter than Max's.
const svfQ = (resonance: number): number => {
  const d = 1.2 * (1 - Math.min(1, Math.max(0, resonance)));
  return 1 / Math.max(0.0001, Math.min(1, d * d));
};
const svfQdB = (resonance: number): number => 20 * Math.log10(svfQ(resonance));

register('svf~', (args, { ctx }) => {
  const freq = num(args[0], 1000);
  const res = num(args[1], 0);
  const node = tryWorkletNode(ctx, PROCESSORS.svf, { numberOfInputs: 1, numberOfOutputs: 4, outputChannelCount: [1, 1, 1, 1] });
  const pFreq = node?.parameters.get('freq');
  const pRes = node?.parameters.get('res');
  if (node && pFreq && pRes) {
    pFreq.value = quarterRate(ctx, freq);
    pRes.value = res;
    const outs = [0, 1, 2, 3].map((i) => {
      const g = new GainNode(ctx, { gain: 1 });
      node.connect(g, i);
      return g;
    });
    return {
      signalIns: [node, pFreq, pRes],
      signalOuts: outs,
      controlIns: [
        undefined,
        (m) => { const n = firstNum(m); if (n !== undefined) pFreq.value = quarterRate(ctx, n); },
        (m) => { const n = firstNum(m); if (n !== undefined) pRes.value = n; },
      ],
      dispose: () => {
        try { node.disconnect(); } catch { /* nothing connected */ }
        for (const g of outs) { try { g.disconnect(); } catch { /* nothing connected */ } }
      },
    } satisfies MaxNode;
  }
  const input = new GainNode(ctx, { gain: 1 });
  const mk = (type: BiquadFilterType, q: number) => {
    const f = new BiquadFilterNode(ctx, { type, frequency: freq, Q: q });
    input.connect(f);
    return f;
  };
  const lp = mk('lowpass', svfQdB(res));
  const hp = mk('highpass', svfQdB(res));
  const bp = mk('bandpass', svfQ(res));
  const notch = mk('notch', svfQ(res));
  const all = [lp, hp, bp, notch];
  const setRes = (r: number): void => {
    lp.Q.value = svfQdB(r);
    hp.Q.value = svfQdB(r);
    bp.Q.value = svfQ(r);
    notch.Q.value = svfQ(r);
  };
  return {
    // Signal-rate freq/Q target the lowpass; control messages fan out to all four.
    signalIns: [input, lp.frequency, lp.Q],
    signalOuts: [lp, hp, bp, notch],
    controlIns: [
      undefined,
      (m) => { const n = firstNum(m); if (n !== undefined) for (const f of all) f.frequency.value = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) setRes(n); },
    ],
  } satisfies MaxNode;
});

// reson~ : resonant bandpass. args/inlets: gain, center frequency, Q.
// Maps to a bandpass biquad (freq + Q) followed by an output gain stage.
register('reson~', (args, { ctx }) => {
  const filter = new BiquadFilterNode(ctx, {
    type: 'bandpass',
    frequency: num(args[1], 1000),
    Q: num(args[2], 1),
  });
  const out = new GainNode(ctx, { gain: num(args[0], 1) });
  filter.connect(out);
  return {
    signalIns: [filter, out.gain, filter.frequency, filter.Q],
    signalOuts: [out],
    controlIns: [
      undefined,
      (m) => { const n = firstNum(m); if (n !== undefined) out.gain.value = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) filter.frequency.value = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) filter.Q.value = n; },
    ],
  } satisfies MaxNode;
});

// cross~ : 2-way crossover. One input, two outputs (low band, high band) split at
// the cutoff frequency. Approximated with a lowpass + highpass biquad pair sharing
// the input. inlet 1 sets the cutoff for both bands.
register('cross~', (args, { ctx }) => {
  const cutoff = num(args[0], 1000);
  const input = new GainNode(ctx, { gain: 1 });
  const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: cutoff });
  const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: cutoff });
  input.connect(lp);
  input.connect(hp);
  return {
    // Signal-rate cutoff targets the lowpass; a control message moves both bands.
    signalIns: [input, lp.frequency],
    signalOuts: [lp, hp],
    controlIns: [
      undefined,
      (m) => {
        const n = firstNum(m);
        if (n !== undefined) { lp.frequency.value = n; hp.frequency.value = n; }
      },
    ],
  } satisfies MaxNode;
});

// teeth~ : comb filter with independent feedforward and feedback delay lines.
// args/inlets: feedforward-delay, feedback-delay (both in SAMPLES), gain,
// feedforward-gain, feedback-gain. Built from DelayNodes; the feedback path forms a
// legal Web Audio cycle because its delay is clamped to at least one render quantum.
// NOTE: delay inlets are exposed as delayTime AudioParams (seconds); control
// messages convert samples->seconds, but a raw signal cord carries the wrong scale.
register('teeth~', (args, { ctx }) => {
  const sr = ctx.sampleRate;
  const minLoop = 128 / sr; // one render quantum keeps the feedback cycle legal
  const samp2sec = (samples: number) => Math.max(0, samples) / sr;

  const input = new GainNode(ctx, { gain: 1 });
  const sum = new GainNode(ctx, { gain: 1 });
  const out = new GainNode(ctx, { gain: num(args[2], 1) });
  const ffDelay = new DelayNode(ctx, { maxDelayTime: 10, delayTime: samp2sec(num(args[0], 0)) });
  const ffGain = new GainNode(ctx, { gain: num(args[3], 1) });
  const fbDelay = new DelayNode(ctx, {
    maxDelayTime: 10,
    delayTime: Math.max(samp2sec(num(args[1], 0)), minLoop),
  });
  const fbGain = new GainNode(ctx, { gain: num(args[4], 0) });

  input.connect(sum);                 // dry path
  input.connect(ffDelay);             // feedforward path
  ffDelay.connect(ffGain);
  ffGain.connect(sum);
  sum.connect(fbDelay);               // feedback loop
  fbDelay.connect(fbGain);
  fbGain.connect(sum);
  sum.connect(out);                   // output stage

  return {
    signalIns: [input, ffDelay.delayTime, fbDelay.delayTime, out.gain, ffGain.gain, fbGain.gain],
    signalOuts: [out],
    controlIns: [
      undefined,
      (m) => { const n = firstNum(m); if (n !== undefined) ffDelay.delayTime.value = samp2sec(n); },
      (m) => { const n = firstNum(m); if (n !== undefined) fbDelay.delayTime.value = Math.max(samp2sec(n), minLoop); },
      (m) => { const n = firstNum(m); if (n !== undefined) out.gain.value = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) ffGain.gain.value = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) fbGain.gain.value = n; },
    ],
  } satisfies MaxNode;
});
