// Audio (MSP) filter objects — the "filters" batch. Each maps a Max ~ filter to
// Web Audio nodes. Importing this module for its side effects registers the
// factories in the global registry.
//
// Fidelity notes are inline. The goal for the prototype is "recognisably correct
// sound", not sample-accurate parity with Max's DSP. True acoustic response is
// verified later in browser mode; here we only guarantee correct I/O wiring.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum, nums, type Msg } from '../../runtime/atoms';
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

// teeth~ : a comb filter with separate feedforward and feedback delays. Per Max's
// reference:  y[n] = a*x[n] + b*x[n - FF] + c*y[n - FB]
// args:    max delay (ms; 0 or none = 10), FF delay (ms, default 10), FB delay (ms,
//          default 10), a, b, c (each default 0). Delays never exceed the max delay.
// inlets:  0 signal in (or a list "FF FB a b c"), 1 FF delay ms, 2 FB delay ms, 3 a,
//          4 b, 5 c - each a float or a signal.
//
// With worklets this is two comb~ processors in series, both running Max's recurrence at
// the sample: the first (a=0, b, c=0, D=FF) makes b*x[n-FF]; a gain adds a*x[n]; the
// second (a=1, b=0, c, D=FB) adds the feedback. A delay set by a number is cut to whole
// samples, and one driven by a signal (ms) replaces the number, as with comb~.
// Without worklets (Node, or no preload) DelayNodes stand in; the feedback cycle there
// cannot be shorter than one render quantum (128 samples, about 3 ms).
register('teeth~', (args, { ctx }) => {
  const maxArg = num(args[0], 0);
  const maxMs = maxArg > 0 ? maxArg : 10;
  const clampMs = (ms: number) => Math.max(0, Math.min(maxMs, ms));
  const ff0 = clampMs(num(args[1], 10));
  const fb0 = clampMs(num(args[2], 10));
  const a0 = num(args[3], 0);
  const b0 = num(args[4], 0);
  const c0 = num(args[5], 0);

  const input = new GainNode(ctx, { gain: 1 });
  const direct = new GainNode(ctx, { gain: a0 }); // a
  const sum = new GainNode(ctx, { gain: 1 });
  input.connect(direct).connect(sum);

  const ffNode = tryWorkletNode(ctx, PROCESSORS.comb, { numberOfInputs: 2, processorOptions: { maxDelayMs: maxMs } });
  const fbNode = ffNode && tryWorkletNode(ctx, PROCESSORS.comb, { numberOfInputs: 2, processorOptions: { maxDelayMs: maxMs } });

  // setters shared by the inlets and by a list into the left inlet
  let setFF: (ms: number) => void;
  let setFB: (ms: number) => void;
  let gainB: AudioParam;
  let gainC: AudioParam;
  let ffIn: AudioNode | AudioParam;
  let fbIn: AudioNode | AudioParam;
  let out: AudioNode;
  let dispose: (() => void) | undefined;

  if (ffNode && fbNode) {
    const p = (n: AudioWorkletNode, k: string) => n.parameters.get(k)!;
    p(ffNode, 'a').value = 0; p(ffNode, 'c').value = 0; p(ffNode, 'b').value = b0;
    p(fbNode, 'a').value = 1; p(fbNode, 'b').value = 0; p(fbNode, 'c').value = c0;
    p(ffNode, 'delay').value = ff0;
    p(fbNode, 'delay').value = fb0;
    const ffSweep = new GainNode(ctx, { gain: 1 });
    const fbSweep = new GainNode(ctx, { gain: 1 });
    ffSweep.connect(ffNode, 0, 1);
    fbSweep.connect(fbNode, 0, 1);
    input.connect(ffNode).connect(sum);   // b * x[n-FF]
    sum.connect(fbNode);                  // + c * y[n-FB]
    setFF = (ms) => { p(ffNode, 'delay').value = clampMs(ms); };
    setFB = (ms) => { p(fbNode, 'delay').value = clampMs(ms); };
    gainB = p(ffNode, 'b');
    gainC = p(fbNode, 'c');
    ffIn = ffSweep;
    fbIn = fbSweep;
    out = fbNode;
    dispose = () => {
      for (const n of [ffSweep, fbSweep, ffNode, fbNode]) {
        try { n.disconnect(); } catch { /* nothing connected */ }
      }
    };
  } else {
    const minLoop = 128 / ctx.sampleRate; // one render quantum keeps the cycle legal
    const ffDelay = new DelayNode(ctx, { maxDelayTime: maxMs / 1000 + minLoop, delayTime: ff0 / 1000 });
    const ffGain = new GainNode(ctx, { gain: b0 });
    const fbDelay = new DelayNode(ctx, { maxDelayTime: maxMs / 1000 + minLoop, delayTime: Math.max(fb0 / 1000, minLoop) });
    const fbGain = new GainNode(ctx, { gain: c0 });
    const output = new GainNode(ctx, { gain: 1 });
    input.connect(ffDelay).connect(ffGain).connect(sum);
    sum.connect(output);
    output.connect(fbDelay).connect(fbGain).connect(sum);
    // A signal in ms reaches the delayTime param (seconds) through a 1/1000 gain.
    const ffScale = new GainNode(ctx, { gain: 0.001 });
    const fbScale = new GainNode(ctx, { gain: 0.001 });
    ffScale.connect(ffDelay.delayTime);
    fbScale.connect(fbDelay.delayTime);
    setFF = (ms) => { ffDelay.delayTime.value = clampMs(ms) / 1000; };
    setFB = (ms) => { fbDelay.delayTime.value = Math.max(clampMs(ms) / 1000, minLoop); };
    gainB = ffGain.gain;
    gainC = fbGain.gain;
    ffIn = ffScale;
    fbIn = fbScale;
    out = output;
  }

  const setters: ((n: number) => void)[] = [
    setFF,
    setFB,
    (n) => { direct.gain.value = n; },
    (n) => { gainB.value = n; },
    (n) => { gainC.value = n; },
  ];
  const one = (i: number) => (m: Msg) => { const n = firstNum(m); if (n !== undefined) setters[i](n); };

  return {
    signalIns: [input, ffIn, fbIn, direct.gain, gainB, gainC],
    signalOuts: [out],
    controlIns: [
      // "The five parameters can be provided as a list in the left inlet."
      (m) => { nums(m).slice(0, 5).forEach((n, i) => setters[i](n)); },
      one(0), one(1), one(2), one(3), one(4),
    ],
    dispose,
  } satisfies MaxNode;
});
