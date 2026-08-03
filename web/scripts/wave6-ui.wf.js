export const meta = {
  name: 'wave6-ui-widgets',
  description: 'Implement Max UI widget objects (slider/dial/number/toggle/umenu…) with DOM + headless message tests',
  phases: [
    { title: 'Implement', detail: 'one agent per widget batch' },
    { title: 'Verify', detail: 'run the full suite once' },
    { title: 'Fix', detail: 'repair failures' },
    { title: 'Re-verify', detail: 'confirm green' },
  ],
};

const BATCHES = [
  { key: 'sliders', objects: 'slider dial kslider rslider nslider incdec', note: 'A range widget with a stored value. Left inlet / interaction sets value in [min,max] (with size/mult args) and emits it. kslider is a keyboard (emits MIDI note on key). incdec spins up/down.' },
  { key: 'numbers-ui', objects: 'numbox flonum2 pictslider hslider vslider', note: 'Number-box style widgets: display + edit a value, emit on change, bang re-outputs. Skip anything absent from manifest with a reason (number/flonum are already implemented in control/index.ts).' },
  { key: 'menus', objects: 'umenu tab radiogroup matrixctrl multislider', note: 'umenu: an index->item selector, emits selected index/symbol. tab: like umenu as tabs. matrixctrl: a grid of cells emitting [col row value]. multislider: a list of values.' },
  { key: 'display', objects: 'led comment panel hint bgcolor jit.pwindow number~', note: 'Mostly display-only. led toggles color on 0/nonzero. comment/panel/hint are passive (no outlets) — provide a DOM el and no behavior. Skip absent ones.' },
];

function prompt(b) {
  return `You are implementing Max **UI widget** objects for a browser Web Audio engine, in ./web.

BATCH "${b.key}". Candidate objects: ${b.objects}
Batch note: ${b.note}

Read first (contracts + patterns):
- web/src/objects/control/index.ts (toggle/button/number reference), web/src/engine/registry.ts (register, MaxNode — note the optional \`el?: HTMLElement\` field and \`dispose?\`), web/src/runtime/atoms.ts (BANG, firstNum, Msg), web/src/runtime/outlets.ts (makeOutlets).
- web/src/generated/manifest.json — AUTHORITATIVE inlet/outlet arity + outlet domains + args. Match EXACTLY.
- web/src/ui/graph.ts — shows how a node's \`el\` is mounted (foreignObject). Your \`el\` should be a small self-contained element.

RULES (critical):
1. Create ONE new module: web/src/objects/ui/${b.key}.ts (self-registering). The objects/ui/ dir is new — that's fine, the bootstrap globs objects/*/*.ts. Do NOT edit any existing/shared file.
2. Only implement objects present in manifest.json and currently Tier-A stubs; SKIP already-implemented (toggle button number flonum int float) and absent ones (record in "skipped" with a reason).
3. Behavior: a widget stores a value and EMITS control messages via makeOutlets when it changes; receiving a number on its inlet sets the value (and emits); bang re-outputs. Match manifest I/O.
4. DOM must be OPTIONAL: guard every DOM call with \`if (typeof document !== 'undefined')\`. Create \`el\` (e.g. an <input type=range> for a slider) ONLY when document exists, and wire its 'input'/'click' event to the SAME value-set function your inlet uses. In headless tests document is undefined, so el stays undefined and the object still builds — the message behavior is what you unit-test.
5. Create ONE new test: web/test/objects/ui-${b.key}.test.ts. Import your module DIRECTLY (import '../../src/objects/ui/${b.key}') + registry — NOT the bootstrap. Run in Node (no DOM). Build with getFactory(name)(args,{ctx:{}}); assert: object builds with el === undefined (headless); sending a number to the inlet emits the (clamped) value; bang re-emits; range/mult args are respected. Do NOT test DOM events (no jsdom here) — the widget's value logic must be reachable via controlIns for testing.
6. Self-check: cd web && npx vitest run test/objects/ui-${b.key}.test.ts until green. Skip untestable/DOM-only objects with a reason rather than faking.

Return JSON: { batch, file, implemented:[...], skipped:[{name,reason}...], testsPassing:bool, notes }.`;
}

const IMPL_SCHEMA = { type: 'object', properties: { batch: { type: 'string' }, file: { type: 'string' }, implemented: { type: 'array', items: { type: 'string' } }, skipped: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } }, required: ['name', 'reason'] } }, testsPassing: { type: 'boolean' }, notes: { type: 'string' } }, required: ['batch', 'implemented', 'testsPassing'] };
const VERIFY_SCHEMA = { type: 'object', properties: { passed: { type: 'boolean' }, total: { type: 'number' }, failed: { type: 'number' }, failingFiles: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['passed', 'summary'] };

phase('Implement');
const results = await parallel(BATCHES.map((b) => () => agent(prompt(b), { label: `impl:${b.key}`, phase: 'Implement', agentType: 'general-purpose', effort: 'medium', schema: IMPL_SCHEMA })));
const impl = results.filter(Boolean);
const implementedTotal = impl.reduce((n, r) => n + (r.implemented?.length ?? 0), 0);
log(`Implement done: ${implementedTotal} widgets across ${impl.length}/${BATCHES.length} batches`);

phase('Verify');
const runTests = () => agent(`Verify the web engine. From ./web run BOTH:\n  npm test\n  npm run build\nThe run is GREEN only if BOTH succeed (vitest all-pass AND tsc/vite build with no type errors). Report passed(bool), total/failed test counts, and failing FILE paths (test files that failed OR files with tsc errors). Do not edit anything.`, { label: 'verify', phase: 'Verify', agentType: 'general-purpose', effort: 'low', schema: VERIFY_SCHEMA });
let verify = await runTests();
log(`Verify: ${verify.passed ? 'GREEN' : 'RED'} — ${verify.summary}`);

if (!verify.passed) {
  phase('Fix');
  await agent(`The web-engine suite is failing (${(verify.failingFiles || []).join(', ')}). From ./web run npm test, then FIX. Edit ONLY files this Wave-6 run created under web/src/objects/ui/ and web/test/objects/ui-*.test.ts. Do NOT edit shared/foundation files. Also ensure no unused imports/vars (the build runs tsc with noUnusedLocals). If an object can't be made correct, remove its registration + test and note it. Keep going until npm test AND npm run build are green. Report what changed.`, { label: 'fix', phase: 'Fix', agentType: 'general-purpose', effort: 'high' });
  phase('Re-verify');
  verify = await runTests();
  log(`Re-verify: ${verify.passed ? 'GREEN' : 'RED'} — ${verify.summary}`);
}

return { implementedTotal, batches: impl.map((r) => ({ batch: r.batch, implemented: r.implemented, skipped: r.skipped })), finalVerify: verify };
