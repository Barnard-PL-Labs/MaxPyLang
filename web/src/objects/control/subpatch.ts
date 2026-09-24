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
// Only embedded subpatchers. An abstraction (a box naming another .maxpat file) and
// bpatcher still have no source to run from a pasted or opened patch.

import { Engine } from '../../engine/engine';
import { register, registerAlias, type MaxNode } from '../../engine/registry';
import type { IRNode, IRPatch } from '../../ir/types';
import { parseMaxPat } from '../../parser/maxpat';
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

/** Left to right, as Max numbers a box's ports; `index` breaks a tie. */
function byPosition(a: IRNode, b: IRNode): number {
  return a.rect[0] - b.rect[0] || Number(a.raw?.index ?? 0) - Number(b.raw?.index ?? 0);
}

/** The embedded patch, or an empty one for a `p` typed on the canvas with nothing in it. */
function innerPatch(node: IRNode | undefined): IRPatch {
  const patcher = node?.raw?.patcher as { boxes?: unknown } | undefined;
  if (!patcher || !Array.isArray(patcher.boxes)) return { nodes: [], edges: [], byId: new Map() };
  return parseMaxPat({ patcher });
}

register('patcher', (_args, { ctx, node }) => {
  const patch = innerPatch(node);
  const inletIds = patch.nodes.filter((n) => n.className === 'inlet').sort(byPosition);
  const outletIds = patch.nodes.filter((n) => n.className === 'outlet').sort(byPosition);
  const fromInlet = new Set(inletIds.map((n) => n.id));

  // Cords leaving an inlet are built as control by the engine and as signal by hand
  // below, never both ways by the engine — see the header.
  for (const edge of patch.edges) if (fromInlet.has(edge.from.id)) edge.domain = 'control';

  const inner = new Engine(ctx, { nested: true });
  inner.build(patch);

  const inlets = inletIds.map((n) => inner.getNode(n.id) as Relay | undefined);
  const outlets = outletIds.map((n) => inner.getNode(n.id) as Relay | undefined);

  const signalWires: (() => void)[] = [];
  for (const edge of patch.edges) {
    if (!fromInlet.has(edge.from.id)) continue;
    const pass = (inner.getNode(edge.from.id) as Relay | undefined)?.pass;
    const target = inner.getNode(edge.to.id)?.signalIns[edge.to.inlet];
    if (!pass || !target) continue;
    pass.connect(target as AudioNode & AudioParam);
    signalWires.push(() => pass.disconnect(target as AudioNode & AudioParam));
  }

  return {
    signalIns: inlets.map((r) => r?.pass),
    signalOuts: outlets.map((r) => r?.pass),
    controlIns: inlets.map((r) => (r?.push ? (m: Msg) => r.push!(m) : undefined)),
    onControlOut: (outlet, cb) => outlets[outlet]?.listen?.(cb) ?? (() => {}),
    start: () => void inner.start(),
    stop: () => void inner.stop(),
    dispose() {
      for (const cut of signalWires) {
        try {
          cut();
        } catch {
          /* already gone */
        }
      }
      // clear(), never dispose(): dispose() is page teardown and would reset the
      // page-wide scheduler and buses that the outer patch is still using.
      inner.clear();
    },
  } satisfies MaxNode;
});
registerAlias('p', 'patcher');
