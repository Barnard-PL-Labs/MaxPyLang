export const meta = {
  name: 'wave3-audio-objects',
  description: 'Implement Max MSP (signal) objects as Web Audio nodes, with structural unit tests, self-healing',
  phases: [
    { title: 'Implement', detail: 'one agent per audio batch writes module + isolated tests' },
    { title: 'Verify', detail: 'run the full suite once, collect failures' },
    { title: 'Fix', detail: 'repair any failing batches' },
    { title: 'Re-verify', detail: 'confirm green' },
  ],
};

// Disjoint audio batches — each owns ONE new module (objects/audio/<key>.ts) + ONE
// new test (test/objects/audio-<key>.test.ts). Names are canonical MSP classes;
// exact arity + domains come from the manifest. cycle~ phasor~ *~ +~ -~ clip~
// lores~ gain~ ezdac~ are already implemented in audio/index.ts — SKIP those.
const BATCHES = [
  { key: 'osc', objects: 'saw~ rect~ tri~ noise~ pink~ train~ vs~', map: 'OscillatorNode (saw/square/triangle types); noise~/pink~ via a buffer of random samples looped or an AudioWorklet; train~ = pulse.' },
  { key: 'sigmath', objects: '/~ !-~ !/~ sig~ pow~ abs~ sqrt~ +=~', map: 'GainNode / ConstantSourceNode / WaveShaperNode. sig~ = a ConstantSourceNode (constant signal). abs~/pow~/sqrt~ via WaveShaper curves.' },
  { key: 'filters', objects: 'biquad~ onepole~ svf~ reson~ hip~ lop~ bp~ notch~ cross~ teeth~', map: 'BiquadFilterNode with the matching type (lowpass/highpass/bandpass/notch). onepole~/svf~ may need an IIRFilterNode or AudioWorklet; approximate with Biquad where reasonable.' },
  { key: 'delay', objects: 'delay~ tapin~ tapout~ delread~ delwrite~ comb~', map: 'DelayNode. tapin~/tapout~ share a DelayNode (put both in this file). delwrite~/delread~ share a named delay line (module-local Map). comb~ = delay + feedback gain.' },
  { key: 'env', objects: 'line~ curve~ adsr~ trapezoid~ rampsmooth~', map: 'A ConstantSourceNode whose .offset is automated with linearRampToValueAtTime / setTargetAtTime. line~ ramps to a target over ms; adsr~ triggers an envelope.' },
  { key: 'pan', objects: 'pan~ pan2~', map: 'StereoPannerNode, or two GainNodes for equal-power L/R. Position via inlet 1 (control or signal).' },
  { key: 'dynamics', objects: 'limi~ degrade~ gate~ round~ deltaclip~', map: 'DynamicsCompressorNode for limi~; WaveShaper for degrade~/deltaclip~; gate~ = a GainNode gated by a control/threshold.' },
  { key: 'routing', objects: 'matrix~ selector~ send~ receive~ mix~ xfade~', map: 'GainNode + ChannelMerger/Splitter. send~/receive~ share a named audio bus (module-local Map of GainNodes) — put both in this file. selector~ routes one of N inlets to the outlet.' },
  { key: 'sampler', objects: 'buffer~ play~ groove~ record~ wave~ index~ peek~ poke~ 2d.wave~', map: 'AudioBufferSourceNode + a named-buffer registry (module-local Map keyed by buffer name). buffer~ declares a buffer; play~/groove~ play it. Empty/zero buffer is fine as default.' },
  { key: 'analysis', objects: 'meter~ snapshot~ avg~ peakamp~ number~ thresh~ edge~', map: 'AnalyserNode for level/meter; these emit CONTROL messages on their control outlets (use makeOutlets). snapshot~ samples the signal periodically via the scheduler.' },
];

function prompt(b) {
  return `You are implementing Max **MSP (signal-domain)** objects as Web Audio nodes for a browser engine, in the repo at ./web.

BATCH "${b.key}". Candidate objects: ${b.objects}
Mapping hint: ${b.map}

Read these first (they define the contract you MUST follow):
- web/src/objects/audio/index.ts   — the REFERENCE PATTERN (cycle~, *~, lores~, ezdac~, gain~). Copy its style.
- web/src/engine/registry.ts        — register(), MaxNode, num(). signalIns/signalOuts are AudioNode|AudioParam indexed by inlet/outlet.
- web/src/runtime/atoms.ts           — firstNum(m) to read a control message into a number.
- web/src/runtime/outlets.ts         — makeOutlets() for any CONTROL outlets (e.g. meter~).
- web/src/runtime/scheduler.ts       — scheduler.everyMs for objects that sample/emit over time (snapshot~, meter~).
- web/src/generated/manifest.json    — AUTHORITATIVE inlet/outlet arity + outlet domains + args for EACH object. Match numInlets/numOutlets/outletDomains EXACTLY.

RULES (critical):
1. Create exactly ONE new module: web/src/objects/audio/${b.key}.ts — self-registering. Do NOT edit ANY existing file (not audio/index.ts, not the foundation — nothing shared). New files only.
2. Only implement objects currently Tier-A stubs; SKIP anything already implemented (cycle~ phasor~ *~ +~ -~ clip~ lores~ gain~ ezdac~) or absent from the manifest (record it in "skipped" with a reason).
3. Match manifest I/O exactly. Signal inlets/outlets are Web Audio nodes/params in signalIns/signalOuts. Control inlets (e.g. a float setting frequency) read via firstNum(m) and set an AudioParam .value. Objects with control OUTLETS (meter~, snapshot~, peakamp~) must provide onControlOut via makeOutlets and emit numeric messages. Provide dispose() if you allocate scheduler timers or shared buffers.
4. Create ONE new test: web/test/objects/audio-${b.key}.test.ts. It MUST import your module DIRECTLY (import '../../src/objects/audio/${b.key}') and the registry — NOT '../../src/objects'. Build with a mock context:  const ctx = new (globalThis).OfflineAudioContext(2,128,44100)  (a headless Web Audio mock is installed by test setup). Assert what IS observable headlessly: the object builds; signalOuts[i] exists for each signal outlet; creation args land on the right AudioParam .value (e.g. lores~ 800 -> signalIns[1].value === 800); a control message to a param inlet updates that param's .value; control-outlet objects emit via onControlOut when driven. NOTE: true acoustic response (does the filter attenuate?) is verified later in browser mode — do NOT try to assert real audio here.
5. Self-check: run  cd web && npx vitest run test/objects/audio-${b.key}.test.ts  and iterate until green. If an object genuinely needs an AudioWorklet or DSP you can't finish, leave it stubbed and record it in "skipped" with a reason — do NOT fake a test.

Return JSON: { batch, file, implemented: [names...], skipped: [{name, reason}...], testsPassing: bool, notes }.`;
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    batch: { type: 'string' },
    file: { type: 'string' },
    implemented: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] } },
    testsPassing: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['batch', 'implemented', 'testsPassing'],
};
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    total: { type: 'number' },
    failed: { type: 'number' },
    failingFiles: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['passed', 'summary'],
};

phase('Implement');
const results = await parallel(
  BATCHES.map((b) => () =>
    agent(prompt(b), { label: `impl:${b.key}`, phase: 'Implement', agentType: 'general-purpose', effort: 'medium', schema: IMPL_SCHEMA })
  )
);
const impl = results.filter(Boolean);
const implementedTotal = impl.reduce((n, r) => n + (r.implemented?.length ?? 0), 0);
log(`Implement done: ${implementedTotal} audio objects across ${impl.length}/${BATCHES.length} batches`);

phase('Verify');
const runTests = () =>
  agent(
    `Run the full web-engine test suite and report the result. From the repo root:\n  cd web && npm test\nReport passed (bool), total/failed counts, and the list of failing test FILE paths. Do not edit anything.`,
    { label: 'verify', phase: 'Verify', agentType: 'general-purpose', effort: 'low', schema: VERIFY_SCHEMA }
  );
let verify = await runTests();
log(`Verify: ${verify.passed ? 'GREEN' : 'RED'} — ${verify.summary}`);

if (!verify.passed) {
  phase('Fix');
  await agent(
    `The web-engine test suite is failing. Failing files: ${(verify.failingFiles || []).join(', ') || '(see output)'}.
From ./web run  npm test  to see failures, then FIX them. Edit ONLY the files this Wave-3 run created under web/src/objects/audio/ (osc,sigmath,filters,delay,env,pan,dynamics,routing,sampler,analysis .ts) and web/test/objects/audio-*.test.ts. Do NOT edit any shared/foundation file or audio/index.ts. If an object can't be made correct, remove its registration + its test and note it. Keep going until  npm test  is fully green. Report what you changed.`,
    { label: 'fix', phase: 'Fix', agentType: 'general-purpose', effort: 'high' }
  );
  phase('Re-verify');
  verify = await runTests();
  log(`Re-verify: ${verify.passed ? 'GREEN' : 'RED'} — ${verify.summary}`);
}

return {
  implementedTotal,
  batches: impl.map((r) => ({ batch: r.batch, implemented: r.implemented, skipped: r.skipped, testsPassing: r.testsPassing })),
  finalVerify: verify,
};
