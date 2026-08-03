export const meta = {
  name: 'wave5-control-longtail',
  description: 'Implement the tractable long tail of Max control objects (trig/bitwise, dataflow, coll, dict, triggers, match)',
  phases: [
    { title: 'Implement', detail: 'one agent per batch writes module + isolated tests' },
    { title: 'Verify', detail: 'run the full suite once' },
    { title: 'Fix', detail: 'repair failures' },
    { title: 'Re-verify', detail: 'confirm green' },
  ],
};

const BATCHES = [
  { key: 'math2', objects: 'acos asin atan atan2 acosh asinh atanh cosh sinh tanh bitand bitor bitxor bitshift div minus modulo rminus rdiv', note: 'Unary trig / hyperbolic (radians). Bitwise: bitand/bitor use integer ops. div/minus/modulo are the canonical binary-math objects (left triggers, right stores) behind aliases & | / - %. Skip any already implemented (rminus/rdiv may exist).' },
  { key: 'flow', objects: 'change accum histo past follow bondo decode offer peak trough onebang2 gate2', note: 'change: output only when the value changes. accum: running accumulator (add on left, set on right). histo: histogram counts. past/peak/trough: threshold crossers. bondo: sync/hold. Skip absent-from-manifest names with a reason.' },
  { key: 'coll', objects: 'coll itable table funbuff2', note: 'coll: an in-memory Map from index (int or symbol) to a stored message (Atom[]). Support: store (address then list via inlet), recall (int/symbol -> output stored at that address on outlet 0), bang dumps, clear, next/prev. Use a module-local Map. This is high value — many patches use coll. Best-effort but faithful for the common store/recall path.' },
  { key: 'dict', objects: 'dict dict.pack dict.unpack dict.route dict.slice dict.strip dict.group dict.join dict.iter dict.serialize dict.deserialize', note: 'dict: a named in-memory key->value store (JS object). dict.pack/unpack convert between messages and a dict. Best-effort; skip serialize/deserialize if they need a real JSON<->dict bridge you cannot finish, with a reason.' },
  { key: 'triggers', objects: 'loadbang loadmess closebang freebang active date cpuclock key keyup keyup2', note: 'loadbang/loadmess: fire once at load (emit on the transport start hook via a start() that emits; or emit immediately on build). loadmess emits its args. date/cpuclock: emit numbers on bang. key/keyup: key codes — since no real keyboard in headless tests, just wire the outlets and test that a simulated input passes through. Skip absent names.' },
  { key: 'match', objects: 'match combine join split spell listfunnel bline anal', note: 'match: fire when the incoming sequence matches the args. combine/join: concatenate messages. split: partition by threshold. spell: text -> ascii codes. anal: pair statistics. Best-effort; skip anything needing heavy state with a reason.' },
];

function prompt(b) {
  return `You are implementing Max **control-domain** objects for a browser Web Audio engine, in ./web.

BATCH "${b.key}". Candidate objects: ${b.objects}
Batch note: ${b.note}

Read first (the contract):
- web/src/objects/control/index.ts and web/src/objects/control/math.ts — REFERENCE PATTERNS. Copy the style.
- web/src/engine/registry.ts (register, MaxNode, num), web/src/runtime/atoms.ts (BANG, firstNum, nums, isBang, int, float, Msg, Atom), web/src/runtime/outlets.ts (makeOutlets), web/src/runtime/scheduler.ts, web/src/runtime/buses.ts.
- web/src/generated/manifest.json — AUTHORITATIVE inlet/outlet arity + outlet domains + args per object. Match EXACTLY.

RULES (critical):
1. Create exactly ONE new module: web/src/objects/control/${b.key}.ts (self-registering). Do NOT edit any existing/shared file. New files only.
2. Only implement objects currently Tier-A stubs; SKIP already-implemented ones and anything ABSENT from manifest.json (record in "skipped" with a reason). Verify presence with the manifest before implementing.
3. Match manifest I/O exactly. controlIns[i] receives a Msg; emit with makeOutlets().emit(outlet, msg). Provide onControlOut. dispose() if you allocate timers/subscriptions/shared state.
4. Create ONE new test: web/test/objects/${b.key}.test.ts. Import your module DIRECTLY (import '../../src/objects/control/${b.key}') + the registry — NOT the '../../src/objects' bootstrap. Build with getFactory(name)(args,{ctx:{}}); assert golden input->output. Use vi.useFakeTimers()+scheduler.start() for any timed object.
5. Self-check: cd web && npx vitest run test/objects/${b.key}.test.ts until green. If an object genuinely needs infra you can't finish (a real editor UI, file I/O, a JSON bridge), leave it stubbed and record it in "skipped" with a one-line reason — never fake a passing test.

Return JSON: { batch, file, implemented:[...], skipped:[{name,reason}...], testsPassing:bool, notes }.`;
}

const IMPL_SCHEMA = { type: 'object', properties: { batch: { type: 'string' }, file: { type: 'string' }, implemented: { type: 'array', items: { type: 'string' } }, skipped: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] } }, testsPassing: { type: 'boolean' }, notes: { type: 'string' } }, required: ['batch', 'implemented', 'testsPassing'] };
const VERIFY_SCHEMA = { type: 'object', properties: { passed: { type: 'boolean' }, total: { type: 'number' }, failed: { type: 'number' }, failingFiles: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['passed', 'summary'] };

phase('Implement');
const results = await parallel(BATCHES.map((b) => () => agent(prompt(b), { label: `impl:${b.key}`, phase: 'Implement', agentType: 'general-purpose', effort: 'medium', schema: IMPL_SCHEMA })));
const impl = results.filter(Boolean);
const implementedTotal = impl.reduce((n, r) => n + (r.implemented?.length ?? 0), 0);
log(`Implement done: ${implementedTotal} objects across ${impl.length}/${BATCHES.length} batches`);

phase('Verify');
const runTests = () => agent(`Run the full web-engine suite: cd web && npm test. Report passed(bool), total/failed, failing test FILE paths. Do not edit anything.`, { label: 'verify', phase: 'Verify', agentType: 'general-purpose', effort: 'low', schema: VERIFY_SCHEMA });
let verify = await runTests();
log(`Verify: ${verify.passed ? 'GREEN' : 'RED'} — ${verify.summary}`);

if (!verify.passed) {
  phase('Fix');
  await agent(`The web-engine suite is failing (${(verify.failingFiles || []).join(', ')}). From ./web run npm test, then FIX. Edit ONLY files this Wave-5 run created: web/src/objects/control/{math2,flow,coll,dict,triggers,match}.ts and web/test/objects/{math2,flow,coll,dict,triggers,match}.test.ts. Do NOT edit shared/foundation files. If an object can't be made correct, remove its registration + test and note it. Keep going until npm test is fully green. Report what changed.`, { label: 'fix', phase: 'Fix', agentType: 'general-purpose', effort: 'high' });
  phase('Re-verify');
  verify = await runTests();
  log(`Re-verify: ${verify.passed ? 'GREEN' : 'RED'} — ${verify.summary}`);
}

return { implementedTotal, batches: impl.map((r) => ({ batch: r.batch, implemented: r.implemented, skipped: r.skipped })), finalVerify: verify };
