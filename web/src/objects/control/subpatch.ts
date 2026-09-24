// Subpatchers: `p name` / `patcher name` — a patch embedded in a box.
//
// Max saves the inner patch inline, under the box's own `patcher` key, so everything
// needed to run it is already in the IR node's raw box dict. The box runs it on a
// NESTED Engine: same AudioContext, same page-wide scheduler, its own nodes and cords.
// That reuses every wiring rule the top level has — including nested subpatchers, which
// are just more boxes to the inner engine — instead of flattening the inner patch into
// the outer one and having to rename every id to keep the two from colliding.
//
// The box's ports are the inner patch's `inlet` and `outlet` objects, ordered left to
// right by position — that is Max's rule, and the reason moving an inlet in a subpatch
// renumbers the ports on its box. Each one is a relay:
//
//   • control into the box's inlet i → inlet object i emits it into the inner patch;
//     an inner outlet object's input → out of the box's outlet i.
//   • signal travels through a GainNode on each relay. An inner `inlet` saves its
//     outlettype as a control type even when it carries audio, so the engine would wire
//     its cords as control only; the signal half of those cords is wired here, by hand.
//
// The box stays live while it is edited. A `sub` op (doc/ops.ts) — an edit made inside
// this subpatcher on the canvas — reaches `subpatch.apply`, which hands the inner ops to
// the nested engine's own applyOps: the same incremental path the top level uses, so
// adding a box inside a playing subpatcher builds that box and nothing else.
//
// Only embedded subpatchers. An abstraction (a box naming another .maxpat file) and
// bpatcher still have no source to run from a pasted or opened patch.

import { innerPatch, portLayout } from '../../doc/subpatcher';
import { edgeKey, Engine } from '../../engine/engine';
import { register, registerAlias, type MaxNode } from '../../engine/registry';
import type { IRPatch } from '../../ir/types';
import type { Msg } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';
import { unwire } from '../audio/lifecycle';

/** What an inner `inlet` / `outlet` object exposes to the box that contains it. */
interface Relay extends MaxNode {
  /** The signal half of the port: audio into the box's inlet / out of its outlet. */
  pass: GainNode;
  /** inlet: send a message into the inner patch. */
  push?(m: Msg): void;
  /** outlet: hear what the inner patch sends out. */
  listen?(cb: (m: Msg) => void): () => void;
}

register('inlet', (_args, { ctx }) => {
  const o = makeOutlets();
  const pass = new GainNode(ctx, { gain: 1 });
  return {
    signalIns: [],
    signalOuts: [pass],
    controlIns: [],
    onControlOut: o.onControlOut,
    pass,
    push: (m) => o.emit(0, m),
    dispose: () => unwire(pass),
  } satisfies Relay;
});

register('outlet', (_args, { ctx }) => {
  const o = makeOutlets();
  const pass = new GainNode(ctx, { gain: 1 });
  return {
    signalIns: [pass],
    signalOuts: [],
    controlIns: [(m) => o.emit(0, m)],
    pass,
    listen: (cb) => o.onControlOut(0, cb),
    dispose: () => unwire(pass),
  } satisfies Relay;
});

/**
 * The inner patch as the nested engine should see it: cords leaving an `inlet` are
 * built as control by the engine and as signal by hand (see the header), never both ways
 * by the engine. A copy, never an edit of the parsed edges — those are shared with
 * whatever else parsed the same box.
 */
function forEngine(patch: IRPatch): IRPatch {
  const inlet = (id: string) => patch.byId.get(id)?.className === 'inlet';
  return {
    ...patch,
    edges: patch.edges.map((e) => (inlet(e.from.id) && e.domain !== 'control' ? { ...e, domain: 'control' } : e)),
  };
}

register('patcher', (_args, { ctx, node }) => {
  let patch = innerPatch(node);

  const inner = new Engine(ctx, { nested: true });
  inner.build(forEngine(patch));

  // The port arrays are handed to the outer engine ONCE, as this node's own fields, and
  // an edit inside can change what they hold (a new `inlet`, a reordered one). So they
  // are refilled in place rather than replaced; the document brackets such an edit with
  // this box's cords coming off and going back on, and the re-connect reads the new
  // entries. See doc/subpatcher.ts:writeBack.
  const signalIns: (AudioNode | undefined)[] = [];
  const signalOuts: (AudioNode | undefined)[] = [];
  const controlIns: (((m: Msg) => void) | undefined)[] = [];
  let outlets: (Relay | undefined)[] = [];

  const bindPorts = (): void => {
    const layout = portLayout(patch);
    const ins = layout.inlets.map((id) => inner.getNode(id) as Relay | undefined);
    outlets = layout.outlets.map((id) => inner.getNode(id) as Relay | undefined);
    signalIns.splice(0, signalIns.length, ...ins.map((r) => r?.pass));
    signalOuts.splice(0, signalOuts.length, ...outlets.map((r) => r?.pass));
    controlIns.splice(
      0,
      controlIns.length,
      ...ins.map((r) => (r?.push ? (m: Msg) => r.push!(m) : undefined)),
    );
  };

  // The hand-wired signal half of every cord out of an inner `inlet`, keyed like a cord.
  // Reconciled after each inner edit rather than rebuilt, so a cord nobody touched keeps
  // its connection — and its sound — through an edit elsewhere in the subpatcher. An
  // entry is re-made when either end became a different object (a retyped target).
  const wires = new Map<string, { pass: GainNode; target: AudioNode | AudioParam }>();
  const cut = (w: { pass: GainNode; target: AudioNode | AudioParam }): void => {
    try {
      w.pass.disconnect(w.target as AudioNode & AudioParam);
    } catch {
      /* already gone */
    }
  };
  const rewireSignals = (): void => {
    const want = new Map<string, { pass: GainNode; target: AudioNode | AudioParam }>();
    for (const edge of patch.edges) {
      if (patch.byId.get(edge.from.id)?.className !== 'inlet') continue;
      const pass = (inner.getNode(edge.from.id) as Relay | undefined)?.pass;
      const target = inner.getNode(edge.to.id)?.signalIns[edge.to.inlet];
      if (pass && target) want.set(edgeKey(edge), { pass, target });
    }
    for (const [key, w] of wires) {
      const next = want.get(key);
      if (next && next.pass === w.pass && next.target === w.target) continue;
      cut(w);
      wires.delete(key);
    }
    for (const [key, w] of want) {
      if (wires.has(key)) continue;
      w.pass.connect(w.target as AudioNode & AudioParam);
      wires.set(key, w);
    }
  };

  bindPorts();
  rewireSignals();

  return {
    signalIns,
    signalOuts,
    controlIns,
    onControlOut: (outlet, cb) => outlets[outlet]?.listen?.(cb) ?? (() => {}),
    start: () => void inner.start(),
    stop: () => void inner.stop(),
    subpatch: {
      engine: inner,
      apply(ops, next) {
        patch = innerPatch(next);
        const inlet = (id: string) => patch.byId.get(id)?.className === 'inlet';
        const adjusted = ops.map((op) =>
          op.t === 'add-edge' && inlet(op.edge.from.id) && op.edge.domain !== 'control'
            ? { ...op, edge: { ...op.edge, domain: 'control' as const } }
            : op,
        );
        inner.applyOps(adjusted, { node: (id) => patch.byId.get(id) });
        bindPorts();
        rewireSignals();
      },
    },
    dispose() {
      for (const w of wires.values()) cut(w);
      wires.clear();
      // clear(), never dispose(): dispose() is page teardown and would reset the
      // page-wide scheduler and buses that the outer patch is still using.
      inner.clear();
    },
  } satisfies MaxNode;
});
registerAlias('p', 'patcher');
