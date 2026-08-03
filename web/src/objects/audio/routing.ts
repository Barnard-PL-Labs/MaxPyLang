// Routing (MSP) objects — signal-domain patching primitives that move audio
// around the graph rather than generating or shaping it.
//
//   matrix~   : N-in × M-out routing matrix with per-connection gains + a dump outlet.
//   selector~ : route exactly one of N signal inlets to the single outlet.
//   send~ / receive~ : a named audio bus (this file owns the Map of bus GainNodes),
//                      letting audio jump across the patch with no visible cord.
//
// Fidelity notes are inline. The goal is "recognisably correct signal flow", not
// sample-accurate Max parity.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum, nums, type Msg } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';

// ── send~ / receive~ shared named audio bus ─────────────────────────────────────
// A bus is one GainNode per name that acts as a summing/fan-out node: every send~
// on a name connects its input into the bus, and every receive~ on that name taps
// the bus for its output. Memoised so build order (send before receive or vice
// versa) never matters.
const audioBuses = new Map<string, GainNode>();

function getBus(ctx: BaseAudioContext, name: string): GainNode {
  let bus = audioBuses.get(name);
  if (!bus) {
    bus = new GainNode(ctx, { gain: 1 });
    audioBuses.set(name, bus);
  }
  return bus;
}

/** Drop all named audio buses (patch reload). */
export function clearAudioBuses(): void {
  audioBuses.clear();
}

// send~ name : signal inlet feeds the named bus. No outlets.
register('send~', (args, { ctx }) => {
  const name = String(args[0] ?? '');
  const bus = getBus(ctx, name);
  // Incoming signal connects straight into the shared bus node (multiple send~ on
  // the same name all target the same node and therefore sum).
  return {
    signalIns: [bus],
    signalOuts: [],
  } satisfies MaxNode;
});

// receive~ name : the named bus fans out to this outlet. The inlet accepts a
// `set <name>` control message to re-point at a different bus.
register('receive~', (args, { ctx }) => {
  let name = String(args[0] ?? '');
  const out = new GainNode(ctx, { gain: 1 });
  let bus = getBus(ctx, name);
  bus.connect(out);
  return {
    signalIns: [undefined], // inlet is control-only (`set name`), not a signal target
    signalOuts: [out],
    controlIns: [
      (m: Msg) => {
        if (m[0] === 'set' && m[1] !== undefined) {
          bus.disconnect(out);
          name = String(m[1]);
          bus = getBus(ctx, name);
          bus.connect(out);
        }
      },
    ],
    dispose: () => {
      bus.disconnect(out);
    },
  } satisfies MaxNode;
});

// ── selector~ ───────────────────────────────────────────────────────────────────
// selector~ [number-of-inputs] [initially-open-inlet]
// Inlet 0 is an int that selects which signal inlet passes through (0 = none open).
// Inlets 1..N are the signal inputs. Each input has its own gain node (1 when
// selected, 0 otherwise) summed into the single outlet.
register('selector~', (args, { ctx }) => {
  const nInputs = Math.max(1, num(args[0], 1));
  const open = num(args[1], 0);
  const out = new GainNode(ctx, { gain: 1 });
  const inGains: GainNode[] = [];
  for (let i = 0; i < nInputs; i++) {
    const g = new GainNode(ctx, { gain: i + 1 === open ? 1 : 0 });
    g.connect(out);
    inGains.push(g);
  }
  const select = (k: number) => {
    for (let i = 0; i < inGains.length; i++) inGains[i].gain.value = i + 1 === k ? 1 : 0;
  };
  // Inlet 0 = selector int (control); inlets 1..N = signal inputs (the gain nodes).
  const signalIns: (AudioNode | AudioParam | undefined)[] = [undefined, ...inGains];
  const controlIns: (((m: Msg) => void) | undefined)[] = [
    (m: Msg) => { const n = firstNum(m); if (n !== undefined) select(Math.trunc(n)); },
  ];
  for (let i = 0; i < nInputs; i++) controlIns.push(undefined);
  return { signalIns, signalOuts: [out], controlIns } satisfies MaxNode;
});

// ── matrix~ ─────────────────────────────────────────────────────────────────────
// matrix~ [inlets] [outlets] [default-connect-gain]
// An inlets×outlets routing matrix. Each cell (in, out) is a gain node wired
// in[in] -> cell -> out[out]. The leftmost inlet accepts connection messages:
//   `in out value [ramp-ms]`  set/ramp one cell's gain
//   `clear`                    zero every cell
//   `dump`                     emit `in out gain` for every cell on the dump outlet
// Outlets 0..M-1 are the signal outputs; the final outlet is the control dumpout.
register('matrix~', (args, { ctx }) => {
  const nIn = Math.max(1, num(args[0], 2));
  const nOut = Math.max(1, num(args[1], 2));
  const defGain = num(args[2], 0);
  const dumpOutlet = nOut; // last outlet index (control)
  const o = makeOutlets();

  const inGains: GainNode[] = [];
  const outGains: GainNode[] = [];
  for (let i = 0; i < nIn; i++) inGains.push(new GainNode(ctx, { gain: 1 }));
  for (let j = 0; j < nOut; j++) outGains.push(new GainNode(ctx, { gain: 1 }));

  // cells[i][j] : per-connection gain node.
  const cells: GainNode[][] = [];
  for (let i = 0; i < nIn; i++) {
    cells[i] = [];
    for (let j = 0; j < nOut; j++) {
      const cell = new GainNode(ctx, { gain: defGain });
      inGains[i].connect(cell);
      cell.connect(outGains[j]);
      cells[i][j] = cell;
    }
  }

  const setCell = (i: number, j: number, v: number, rampMs?: number) => {
    if (i < 0 || i >= nIn || j < 0 || j >= nOut) return;
    const p = cells[i][j].gain;
    if (rampMs && rampMs > 0) p.linearRampToValueAtTime(v, ctx.currentTime + rampMs / 1000);
    else p.value = v;
  };

  const handle = (m: Msg) => {
    if (m[0] === 'clear') {
      for (let i = 0; i < nIn; i++) for (let j = 0; j < nOut; j++) cells[i][j].gain.value = 0;
      return;
    }
    if (m[0] === 'dump') {
      for (let i = 0; i < nIn; i++)
        for (let j = 0; j < nOut; j++) o.emit(dumpOutlet, [i, j, cells[i][j].gain.value]);
      return;
    }
    const n = nums(m);
    if (n.length >= 3) setCell(Math.trunc(n[0]), Math.trunc(n[1]), n[2], n[3]);
  };

  const signalOuts: (AudioNode | undefined)[] = [...outGains];
  signalOuts[dumpOutlet] = undefined; // control dumpout, not a signal source

  const controlIns: (((m: Msg) => void) | undefined)[] = [handle];
  for (let i = 1; i < nIn; i++) controlIns.push(undefined);

  return {
    signalIns: [...inGains],
    signalOuts,
    controlIns,
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});
