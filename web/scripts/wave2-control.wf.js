export const meta = {
  name: 'wave2-control-objects',
  description: 'Implement Max control-domain objects in the web engine, with unit tests, self-healing',
  phases: [
    { title: 'Implement', detail: 'one agent per control batch writes module + isolated tests' },
    { title: 'Verify', detail: 'run the full suite once, collect failures' },
    { title: 'Fix', detail: 'repair any failing batches' },
    { title: 'Re-verify', detail: 'confirm green' },
  ],
};

// Disjoint batches — each owns ONE new module file + ONE new test file, so agents
// never touch a shared file and never collide. Names are canonical Max classes;
// the exact inlet/outlet arity + domains come from the committed manifest.
const BATCHES = [
  {
    key: 'math',
    objects: '!- !/ == != > < >= <= && || pow sqrt abs sin cos tan exp log min maximum minimum round expr',
    note: 'Binary ops: left inlet triggers, right inlet stores operand (see + in control/index.ts). expr: implement a small shunting-yard evaluator for $i1/$f1 args.',
  },
  {
    key: 'logic',
    objects: 'sel select gate switch router gswitch ggate onebang pass trigger bangbang swap if route routepass',
    note: 'trigger t outputs right-to-left. route/sel match first atom and route/pass through.',
  },
  {
    key: 'list',
    objects: 'zl.rev zl.len zl.slice zl.join zl.sort zl.group zl.sum zl.nth zl.rot zl.change zl.filter zl.delace zl.compare zl.median zl.queue zl.stack pack unpack pak thresh iter bag funnel spray mean bucket',
    note: 'Messages are Atom[]; zl.* operate on lists. zl.rev([1,2,3])=[3,2,1]. Cover as many zl.* as tractable.',
  },
  {
    key: 'timing',
    objects: 'tempo clocker qmetro pipe line uzi speedlim',
    note: 'Use the shared scheduler (runtime/scheduler) so play/stop transport works. pipe delays a value; line ramps; uzi bursts N bangs.',
  },
  {
    key: 'convert',
    objects: 'ftom atodb dbtoa itoa atoi tosymbol fromsymbol sprintf zmap regexp',
    note: 'ftom is inverse of mtof (already done). sprintf/regexp: best-effort, skip if too hard with a reason.',
  },
  {
    key: 'random',
    objects: 'drunk urn decide coin',
    note: 'Use Math.random(). drunk: bounded random walk. urn: random without replacement until exhausted. decide/coin: 0/1.',
  },
  {
    key: 'data',
    objects: 'value v pv funbuff bag prepend append',
    note: 'value/v share named storage via runtime/buses (getValue/setValue). prepend/append modify messages.',
  },
  {
    key: 'midi',
    objects: 'makenote stripnote notein noteout ctlin ctlout bendin bendout pgmin pgmout midiparse midiformat borax flush xnotein',
    note: 'Pure message logic only (no Web MIDI I/O yet). makenote pairs note-on with a delayed note-off (use scheduler). stripnote drops note-offs (velocity 0).',
  },
  {
    key: 'route',
    objects: 'send receive forward prepend2 sprintf2 grab buddy',
    note: 'send/s and receive/r use runtime/buses (subscribe/send by name). Skip any that overlap another batch, with a reason.',
  },
];

function prompt(b) {
  return `You are implementing Max **control-domain** objects for a browser Web Audio engine, in the repo at ./web.

BATCH "${b.key}". Candidate objects: ${b.objects}
Batch note: ${b.note}

Read these first (they define the contract you MUST follow):
- web/src/objects/control/index.ts  — the REFERENCE PATTERN. Copy its style exactly.
- web/src/engine/registry.ts        — register(), MaxNode, num(). Control values are Msg = Atom[].
- web/src/runtime/atoms.ts           — BANG, firstNum, nums, isBang, int, float, Msg, Atom.
- web/src/runtime/outlets.ts         — makeOutlets() fan-out helper (use it for every object).
- web/src/runtime/scheduler.ts       — scheduler.everyMs/afterMs for time-driven objects.
- web/src/runtime/buses.ts           — buses.subscribe/send/getValue/setValue for send/receive/value.
- web/src/generated/manifest.json    — the AUTHORITATIVE inlet/outlet arity + outlet domains + args for EACH object. Look up every object you implement and match its numInlets/numOutlets/outletDomains EXACTLY.

RULES (critical):
1. Create exactly ONE new module file: web/src/objects/control/${b.key}.ts — self-registering (top-level register(...) calls). Do NOT edit ANY existing file (not control/index.ts, not registry.ts, not the bootstrap — nothing shared). New files only.
2. Only implement objects that are currently Tier-A stubs. If an object is already implemented in control/index.ts (e.g. + - * / % metro delay counter random mtof scale int float toggle etc.), SKIP it.
3. For each object: match the manifest I/O exactly. controlIns[i] receives a Msg; emit results with makeOutlets().emit(outlet, msg). Provide onControlOut. Provide a dispose() if you allocate scheduler timers or bus subscriptions.
4. Create ONE new test file: web/test/objects/${b.key}.test.ts. It MUST import your module DIRECTLY (import '../../src/objects/control/${b.key}') and the registry — do NOT import '../../src/objects' (the glob bootstrap). This isolates your tests from other batches. Use getFactory(name)(args, {ctx: {}}) to build; capture onControlOut; assert golden input→output. Use vi.useFakeTimers() + scheduler.start() for timed objects (see control.test.ts).
5. Self-check: run  cd web && npx vitest run test/objects/${b.key}.test.ts  and iterate until it passes. If an object is genuinely too hard (needs a parser you can't finish, external state, etc.), leave it as a stub and record it in "skipped" with a one-line reason — do NOT fake a passing test.
6. Keep behavior faithful but prototype-level (single-atom or simple-list messages; no attributes). Recognisably-correct beats perfect.

Return a JSON object: { batch, file, implemented: [names...], skipped: [{name, reason}...], testsPassing: bool, notes }.`;
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
    agent(prompt(b), {
      label: `impl:${b.key}`,
      phase: 'Implement',
      agentType: 'general-purpose',
      effort: 'medium',
      schema: IMPL_SCHEMA,
    })
  )
);
const impl = results.filter(Boolean);
const implementedTotal = impl.reduce((n, r) => n + (r.implemented?.length ?? 0), 0);
log(`Implement done: ${implementedTotal} objects across ${impl.length}/${BATCHES.length} batches`);

phase('Verify');
const runTests = () =>
  agent(
    `Run the full web-engine test suite and report the result. From the repo root:\n  cd web && npm test\nReport whether it passed, the total/failed test counts, and the list of failing test FILE paths (e.g. test/objects/list.test.ts). Do not edit anything.`,
    { label: 'verify', phase: 'Verify', agentType: 'general-purpose', effort: 'low', schema: VERIFY_SCHEMA }
  );
let verify = await runTests();
log(`Verify: ${verify.passed ? 'GREEN' : 'RED'} — ${verify.summary}`);

if (!verify.passed) {
  phase('Fix');
  await agent(
    `The web-engine test suite is failing. Failing files: ${(verify.failingFiles || []).join(', ') || '(see suite output)'}.
From ./web, run  npm test  to see failures, then FIX them. You may edit ONLY the files under web/src/objects/control/ and web/test/objects/ that this Wave-2 run created (math.ts, logic.ts, list.ts, timing.ts, convert.ts, random.ts, data.ts, midi.ts, route.ts and their tests). Do NOT edit any shared/foundation file (registry, engine, runtime/*, control/index.ts, signature/fuzz tests). If a specific object cannot be made correct, remove its registration + its test and note it. Keep going until  npm test  is fully green. Report what you changed.`,
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
