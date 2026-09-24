// What a `p` / `patcher` box looks like from the outside, derived from what is inside it.
//
// A subpatcher box has no arity of its own: Max numbers its ports from the `inlet` and
// `outlet` objects in the embedded patch, left to right by position, and saves that
// embedded patch inline under the box dict's own `patcher` key. Two modules need that
// rule and must agree on it to the letter — objects/control/subpatch.ts, which runs the
// inner patch and exposes one relay per port, and doc/patch-doc.ts, which writes an edit
// made inside the subpatcher back into the box and has to know when the box's ports moved
// underneath the cords attached to it. A disagreement would be a cord the document draws
// into port 2 that the engine wired into what it thinks is port 1. So the rule lives
// here, once, and both import it. The parser has a third reader, ir/subpatcher.ts's
// subpatcherPorts, which works on the raw box dicts because the parser sits below this
// layer; test/subpatcher-agreement.test.ts holds the two to the same answer.

import { parseMaxPat } from '../parser/maxpat';
import { EMPTY_PATCHER_HEADER, patchToMaxPat } from '../parser/write-maxpat';
import type { Domain, IREdge, IRNode, IRPatch } from '../ir/types';
import type { Op } from './ops';
import { isSubpatcherClass } from '../ir/subpatcher';

/** True for a box that can be opened: an object box running an embedded patch. */
export function isSubpatcher(node: IRNode | undefined): boolean {
  return !!node && node.maxclass === 'newobj' && isSubpatcherClass(node.className);
}

/** Left to right, as Max numbers a box's ports; `index` breaks a tie. */
export function byPosition(a: IRNode, b: IRNode): number {
  return a.rect[0] - b.rect[0] || Number(a.raw?.index ?? 0) - Number(b.raw?.index ?? 0);
}

/**
 * The embedded patch as IR, or an empty one for a `p` typed on the canvas with nothing in
 * it yet. The empty one carries Max's default patcher header, so the first edit inside a
 * fresh `p` writes back a `patcher` dict Max will open, not a bare {boxes, lines}.
 */
export function innerPatch(node: IRNode | undefined): IRPatch {
  const patcher = node?.raw?.patcher as { boxes?: unknown } | undefined;
  if (!patcher || !Array.isArray(patcher.boxes)) {
    return { nodes: [], edges: [], byId: new Map(), header: { ...EMPTY_PATCHER_HEADER } };
  }
  return parseMaxPat({ patcher });
}

/** The box's ports as the inner patch defines them. */
export interface PortLayout {
  /** Inner `inlet` ids, in port order. */
  inlets: string[];
  /** Inner `outlet` ids, in port order. */
  outlets: string[];
  /**
   * Per box outlet: `signal` when a signal cord arrives at that inner `outlet`, else
   * `control`. That is what Max writes into the box's `outlettype` (["signal", ""]), and
   * it is what decides whether a cord out of the box is wired as audio.
   */
  outletDomains: Domain[];
}

export function portLayout(patch: { nodes: Iterable<IRNode>; edges: Iterable<IREdge> }): PortLayout {
  const nodes = [...patch.nodes];
  const inlets = nodes.filter((n) => n.className === 'inlet').sort(byPosition);
  const outlets = nodes.filter((n) => n.className === 'outlet').sort(byPosition);
  const signalInto = new Set<string>();
  for (const e of patch.edges) if (e.domain === 'signal') signalInto.add(e.to.id);
  return {
    inlets: inlets.map((n) => n.id),
    outlets: outlets.map((n) => n.id),
    outletDomains: outlets.map((n) => (signalInto.has(n.id) ? 'signal' : 'control')),
  };
}

function sameLayout(a: PortLayout, b: PortLayout): boolean {
  const eq = (x: readonly string[], y: readonly string[]) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return eq(a.inlets, b.inlets) && eq(a.outlets, b.outlets) && eq(a.outletDomains, b.outletDomains);
}

/**
 * Whether an op list re-instantiates an inner `inlet`/`outlet`. The layout can be
 * identical afterwards — same ids, same order — and the box's ports are still new
 * objects in the engine (a new relay GainNode per port), so every cord on the box has to
 * be re-made against them. Recursing into `sub` is unnecessary: a nested subpatcher's
 * inlets are that box's business, not this one's.
 */
function touchesPortObjects(ops: readonly Op[]): boolean {
  const port = (n: IRNode) => n.className === 'inlet' || n.className === 'outlet';
  return ops.some(
    (op) =>
      ((op.t === 'add-node' || op.t === 'remove-node') && port(op.node)) ||
      (op.t === 'set-box' && (port(op.from) || port(op.to))) ||
      op.t === 'renumber',
  );
}

/**
 * The subpatcher box `prev` after its inner patch became `inner` by way of `ops`.
 *
 * The box dict's `patcher` is rewritten from the inner document — ids NOT renumbered,
 * because the undo record for this edit names inner boxes by id, and so does the nested
 * engine running them; a save of the top document renumbers only the top level — and,
 * when the port layout moved, so are the box's port counts and outlet types, which is
 * what nodeToBox writes as numinlets/numoutlets/outlettype.
 *
 * `rewire` says the cords on the box have to come off and go back on around this edit.
 * Port counts and types are left alone when it is false, so a patch Max saved with its
 * own idea of the box's outlettype keeps it until the user actually changes the ports.
 */
export function writeBack(
  prev: IRNode,
  inner: IRPatch,
  ops: readonly Op[],
): { node: IRNode; rewire: boolean } {
  const patcher = (patchToMaxPat(inner) as { patcher: Record<string, unknown> }).patcher;
  const node: IRNode = { ...prev, raw: { ...(prev.raw ?? {}), patcher } };
  const before = portLayout(innerPatch(prev));
  const after = portLayout(inner);
  const moved = !sameLayout(before, after);
  if (moved) {
    node.numInlets = after.inlets.length;
    node.numOutlets = after.outlets.length;
    node.outletDomains = after.outletDomains;
    node.outletTypes = after.outletDomains.map((d) => (d === 'signal' ? 'signal' : ''));
  }
  return { node, rewire: moved || touchesPortObjects(ops) };
}
