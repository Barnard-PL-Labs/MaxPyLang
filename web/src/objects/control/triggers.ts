// Control-domain trigger / lifecycle / clock objects (BATCH "triggers"):
// load-time and free-time bangs (loadbang, loadmess, closebang, freebang), the
// window-activity report (active), the two clocks (date, cpuclock), and the
// keyboard sources (key, keyup).
//
// This module is self-registering: importing it runs the top-level register(...)
// calls. It touches NO shared file — it only reads the stable contracts (registry,
// outlets, atoms). See control/index.ts for the reference pattern this mirrors.
//
// Lifecycle mapping (engine.ts drives these): a node's start() hook runs on
// transport ▶ and its dispose() hook runs on ■/teardown. So loadbang/loadmess
// emit from start() (fire-once "load"), and closebang/freebang emit from dispose()
// ("patch closed / object freed").

import { register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { BANG, firstNum, isBang, type Msg } from '../../runtime/atoms';

// ── Load-time bangs ───────────────────────────────────────────────────────────

// loadbang : output a single bang when the patch loads (here: on transport start).
// A bang at the inlet re-outputs a bang, matching Max.
register('loadbang', () => {
  const o = makeOutlets();
  let fired = false;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => { if (isBang(m) || firstNum(m) !== undefined) o.emit(0, BANG); }],
    onControlOut: o.onControlOut,
    start: () => { if (!fired) { fired = true; o.emit(0, BANG); } },
  } satisfies MaxNode;
});

// loadmess <message...> : like loadbang, but outputs its creation args as a message
// on load. A bang at the inlet re-outputs the stored message.
register('loadmess', (args) => {
  const o = makeOutlets();
  const message: Msg = args.length ? (args as Msg) : BANG;
  let fired = false;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => { if (isBang(m) || firstNum(m) !== undefined) o.emit(0, message); }],
    onControlOut: o.onControlOut,
    start: () => { if (!fired) { fired = true; o.emit(0, message); } },
  } satisfies MaxNode;
});

// ── Free-time bangs ───────────────────────────────────────────────────────────

// closebang : output a bang when the patcher is closed (here: on dispose/teardown).
register('closebang', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [() => {}],
    onControlOut: o.onControlOut,
    dispose: () => o.emit(0, BANG),
  } satisfies MaxNode;
});

// freebang : output a bang when the object is freed (here: on dispose/teardown).
register('freebang', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [() => {}],
    onControlOut: o.onControlOut,
    dispose: () => o.emit(0, BANG),
  } satisfies MaxNode;
});

// ── Window activity ───────────────────────────────────────────────────────────

// active : reports 1 when the patcher window becomes active, 0 when it becomes
// inactive. Headless has no real window, so the inlet simulates the signal: a
// number sets/echoes the state (nonzero -> 1), a bang re-reports the last state.
register('active', () => {
  const o = makeOutlets();
  let state = 0;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => {
      if (isBang(m)) { o.emit(0, [state]); return; }
      const n = firstNum(m);
      if (n !== undefined) { state = n !== 0 ? 1 : 0; o.emit(0, [state]); }
    }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── Clocks ────────────────────────────────────────────────────────────────────

// date : on a bang, report the current wall-clock date across three outlets.
// Faithful to Max's right-to-left firing, the outlets emit high-to-low:
//   outlet 2 = year, outlet 1 = month (1-12), outlet 0 = day-of-month.
register('date', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => {
      if (!(isBang(m) || firstNum(m) !== undefined)) return;
      const d = new Date();
      o.emit(2, [d.getFullYear()]);
      o.emit(1, [d.getMonth() + 1]);
      o.emit(0, [d.getDate()]);
    }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// cpuclock : on a bang, output a high-resolution millisecond timestamp (a CPU clock
// reading), useful for measuring elapsed time between events.
const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
register('cpuclock', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => { if (isBang(m) || firstNum(m) !== undefined) o.emit(0, [nowMs()]); }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── Keyboard sources ──────────────────────────────────────────────────────────
//
// key / keyup have NO inlets (they are event sources) and four control outlets.
// There is no real keyboard in the headless engine, so each built node registers
// an emitter; a browser host wires document keydown/keyup to simulateKey/simulateKeyUp,
// and tests call those exported helpers directly to verify the outlets pass a key
// event through. Outlet layout mirrors Max: 0 = key/char code, 1 = modifier flags,
// 2 = window-active flag, 3 = raw key code.

type KeyEmit = (code: number) => void;
const keyDownEmitters = new Set<KeyEmit>();
const keyUpEmitters = new Set<KeyEmit>();

/** Deliver a simulated key-press code to every `key` object. */
export function simulateKey(code: number): void {
  for (const emit of keyDownEmitters) emit(code);
}
/** Deliver a simulated key-release code to every `keyup` object. */
export function simulateKeyUp(code: number): void {
  for (const emit of keyUpEmitters) emit(code);
}

function makeKeySource(pool: Set<KeyEmit>) {
  return (): MaxNode => {
    const o = makeOutlets();
    const emit: KeyEmit = (code) => {
      // Right-to-left: highest outlet first.
      o.emit(3, [code]); // raw key code
      o.emit(2, [1]);    // window active
      o.emit(1, [0]);    // modifier flags (none, simulated)
      o.emit(0, [code]); // key / char code
    };
    pool.add(emit);
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [], // no inlets, per the manifest
      onControlOut: o.onControlOut,
      dispose: () => { pool.delete(emit); },
    };
  };
}
register('key', makeKeySource(keyDownEmitters));
register('keyup', makeKeySource(keyUpEmitters));

// In a browser host, bridge real keyboard events to the simulate helpers so `key`
// and `keyup` behave live. Guarded so the headless (node) test environment is a no-op.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  const codeOf = (e: KeyboardEvent): number =>
    typeof e.keyCode === 'number' ? e.keyCode : (e.key ? e.key.charCodeAt(0) : 0);
  document.addEventListener('keydown', (e) => simulateKey(codeOf(e as KeyboardEvent)));
  document.addEventListener('keyup', (e) => simulateKeyUp(codeOf(e as KeyboardEvent)));
}
