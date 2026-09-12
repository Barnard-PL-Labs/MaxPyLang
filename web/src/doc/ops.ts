// Every edit to a patch, expressed as a command object.
//
// This is the load-bearing decision of the whole document layer, and it is worth being
// explicit about why it isn't the obvious one. The obvious undo implementation keeps a
// stack of whole-document snapshots: ~15 lines, impossible to get wrong. It is also
// unusable here, because the document is not the product — a live Web Audio graph and a
// canvas full of mounted widgets are. Restoring a snapshot tells the engine nothing
// except "everything may have changed", so the only honest response is a full
// Engine.build(): every object re-instantiated, every widget's DOM rebuilt (ui/graph.ts
// creates each `el` inside its factory, so a slider mid-drag loses its thumb), every
// control subscription re-made, and DSP interrupted. On every single Cmd-Z.
//
// So each Op here is deliberately two things at once:
//   (a) an undo unit — `invert(op)` is the exact edit that takes the document back, so
//       undo is "apply the inverses in reverse", with no diffing and no snapshot; and
//   (b) a change notification — PatchDoc hands the same op list to its listeners, and
//       Phase 5's Engine.applyOps() maps them one by one onto incremental engine calls
//       (`set-rect` maps to nothing at all, which is precisely the point: dragging a box
//       must not touch audio).
//
// Both properties break the moment an op stops carrying enough state to be reversed on
// its own, which is why `remove-node` carries the whole node and `set-box` carries both
// the old and the new one rather than a patch/delta. Ops are treated as immutable and
// are shared by reference between the undo stack and the change feed; nothing in this
// module or in patch-doc.ts mutates one after it is applied.

import { edgeKey } from '../engine/engine';
import type { IREdge, IRNode } from '../ir/types';

/**
 * One cord's identity, re-exported — NOT redefined.
 *
 * The engine keys its live cords by this string (engine.ts), and the document keys its
 * edges by the same one, so "the cord the doc just removed" and "the cord the engine has
 * to disconnect" are the same lookup with no translation step. A second definition here
 * that drifted by one character would desynchronize the two stores silently.
 */
export { edgeKey };

/**
 * A box's `[x, y, w, h]` in patch coordinates — the tuple IRNode.rect carries.
 *
 * Distinct from ui/layout.ts's `Rect` ({x, y, width, height}), which is screen-space
 * geometry for hit testing. This one is what gets written back to `patching_rect`.
 */
export type Rect = IRNode['rect'];

/**
 * The complete set of edits. Anything the patcher does is a sequence of these.
 *
 * `set-rect` is split out from `set-box` on purpose: moving a box is by far the most
 * frequent edit and the only one the engine can ignore outright, so it gets to be the
 * one op that carries geometry and nothing else.
 *
 * `renumber` exists because dense `obj-1..obj-N` ids are a save/codegen concern, not an
 * editing one (see PatchDoc.reorder). Making it an op rather than a side effect is what
 * keeps it undoable like everything else.
 *
 * It carries TWO maps, and the second one is not redundant. Renaming a box silently
 * rewrites the edgeKey of every cord touching it, and edgeKey is the identity every
 * consumer stores a cord under — Engine.videoEdges today, Phase 5's
 * `Map<edgeKey, teardown>`, Phase 4's `Map<edgeKey, path>`, the patcher's
 * currently-selected cord. Given only the node map, each of those would have to take the
 * key format apart and put it back together, which is a second definition of cord
 * identity and exactly what re-exporting edgeKey above exists to prevent. So the
 * document, which computes the new key for every cord anyway, hands it over:
 * `edgeMap[oldKey] === newKey` for every live cord the renumber moves.
 */
export type Op =
  | { t: 'add-node'; node: IRNode }
  | { t: 'remove-node'; node: IRNode }
  | { t: 'set-rect'; id: string; from: Rect; to: Rect }
  | { t: 'set-box'; id: string; from: IRNode; to: IRNode }
  | { t: 'add-edge'; edge: IREdge }
  | { t: 'remove-edge'; edge: IREdge }
  | { t: 'renumber'; map: Record<string, string>; edgeMap: Record<string, string> };

/** Swap every key with its value. Precondition: `map` is a bijection (reorder's is). */
function invertMap(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(map)) out[to] = from;
  return out;
}

/**
 * The edit that undoes `op`.
 *
 * A true involution: `invert(invert(op))` deep-equals `op` for every variant, which is
 * what makes redo "apply the recorded ops again" rather than a third code path — the
 * redo stack stores the ORIGINAL entry, and undo re-derives its inverses each time.
 *
 * Pure: the input op is never mutated and its payloads (nodes, edges) are shared by
 * reference with the result, since the document never mutates a node or an edge in
 * place — it replaces the object.
 */
export function invert(op: Op): Op {
  switch (op.t) {
    case 'add-node':
      return { t: 'remove-node', node: op.node };
    case 'remove-node':
      return { t: 'add-node', node: op.node };
    case 'set-rect':
      return { t: 'set-rect', id: op.id, from: op.to, to: op.from };
    case 'set-box':
      return { t: 'set-box', id: op.id, from: op.to, to: op.from };
    case 'add-edge':
      return { t: 'remove-edge', edge: op.edge };
    case 'remove-edge':
      return { t: 'add-edge', edge: op.edge };
    case 'renumber':
      // Both maps are bijections over the ids/keys that existed when the op was built,
      // so the inverse renumber's induced key permutation is literally this one read
      // backwards — no need to re-derive it from a document.
      return { t: 'renumber', map: invertMap(op.map), edgeMap: invertMap(op.edgeMap) };
  }
  // Exhaustiveness: adding a variant to Op without inverting it fails to compile here,
  // rather than silently producing an undo entry that doesn't undo.
  const unreachable: never = op;
  throw new Error(`invert: unknown op ${JSON.stringify(unreachable)}`);
}
