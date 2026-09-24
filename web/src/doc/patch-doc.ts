// The mutable patch document: the single source of truth the canvas, the engine, the
// inspector and the writer all read, and the only thing any of them may write through.
//
// It is a thin store on purpose. All of the "what does this box look like" knowledge
// lives in ir/objectspec (resolveBox), all of the "how is this cord keyed" knowledge in
// engine/edgeKey, and all of the "how does an edit come back" knowledge in doc/ops.
// What is left here is the part that cannot live anywhere else: transaction boundaries,
// the undo/redo stacks, id minting, and the guarantee that an edit which needs several
// ops lands as ONE of everything — one undo entry, one listener call, one revision.
//
// Four invariants earn their keep:
//
//   1. Every mutation goes through transact(), so every mutation is undoable and every
//      listener sees a complete, already-consistent op list. Nested transacts flatten,
//      which is what lets a high-level gesture ("paste", "delete selection") compose the
//      primitives below without producing five separate Cmd-Z steps.
//
//   2. A structural change and the cords it invalidates are in the SAME transaction.
//      Shrinking `unpack 1 2 3` to `unpack 1 2` deletes the cord on outlet 2 alongside
//      the retype; deleting a box deletes its incident cords first. If those were
//      separate transactions, an undo could restore a box whose cords were still gone,
//      or (worse) leave the engine holding a cord the document no longer has.
//
//   3. Box ids are minted monotonically and never handed out twice in a session. The
//      undo stack holds ops that name ids; reusing a freed id would silently re-point an
//      outstanding undo record at a different box. Dense `obj-1..obj-N` renumbering is a
//      save/codegen concern and happens only in reorder(), as its own undoable op.
//
//   4. Nodes and edges are immutable by convention: every mutation replaces the object
//      rather than editing it, so an op, an undo record or a listener's cached reference
//      is always a valid snapshot of the moment it was taken.
//
// Ordering. toIR() has to give back boxes and cords in a stable order — a test that
// undoes an edit and compares documents, and a writer that must not reshuffle a file's
// boxes array, both depend on it. Removal therefore doesn't forget WHERE a node lived:
// `slots` is keyed by id and only ever grows (Map.set on an existing key keeps its
// original position), while `live` says which slots currently exist. Undoing a delete
// re-inserts into the same slot and the box comes back exactly where it was in the file.
// A renumber carries the dead slots along rather than compacting them away, so it holds
// through that too — see reorder().

import { edgeKey } from '../engine/engine';
import { boxSpecs, loadBoxSpecs, resolveBox, specToNode } from '../ir/objectspec';
import type { IREdge, IRNode, IRPatch } from '../ir/types';
import { invert, type Op, type Rect } from './ops';
import { innerPatch, isSubpatcher, writeBack } from './subpatcher';

/** Where an op list came from. The engine treats all three alike; a UI may not. */
export type DocSource = 'apply' | 'undo' | 'redo';

/**
 * Called once per transaction with every op it applied, after the document is fully
 * consistent. For 'undo' the ops are the INVERSES actually applied, in the order they
 * were applied, so a listener can replay them verbatim without knowing about undo.
 */
export type DocListener = (ops: readonly Op[], source: DocSource) => void;

/** The handle transact() hands its callback. Valid only for that callback's duration. */
export interface Tx {
  /** Apply one op now. It joins this transaction's undo entry and its notification. */
  apply(op: Op): void;
  /** The ops applied so far in this transaction, in order. */
  ops(): readonly Op[];
  /** Rename the undo entry this transaction will push (the outer label wins when nested). */
  setLabel(label: string): void;
}

interface UndoEntry {
  label: string;
  ops: Op[];
}

/** `obj-7` -> 7. Ids from a hand-written or non-Max patch simply don't participate. */
const ID_SUFFIX = /^obj-(\d+)$/;

/** Node ids as one comparable string, for deciding whether two drags are the same drag. */
function moveKey(ids: readonly string[]): string {
  return `move:${[...ids].sort().join(',')}`;
}

/** A coalesce key recorded on behalf of the subpatcher in box `id`. */
function subKey(id: string, key: string): string {
  return `sub:${id}|${key}`;
}

/** Does this op list reach the subpatcher at `path` (box ids, outermost first)? */
function reaches(ops: readonly Op[], path: readonly string[]): boolean {
  if (path.length === 0) return true;
  return ops.some((op) => op.t === 'sub' && op.id === path[0] && reaches(op.ops, path.slice(1)));
}

/**
 * Fold a later drag step into an earlier one: keep the ORIGINAL `from` and the LATEST
 * `to`, so 20 merged steps still undo to where the box started.
 *
 * Produces new op objects rather than editing the recorded ones, because those have
 * already been handed to listeners, who are entitled to assume an op never changes.
 */
function mergeMoves(prev: readonly Op[], next: readonly Op[]): Op[] {
  const merged = [...prev];
  for (const op of next) {
    if (op.t === 'sub') {
      // A drag INSIDE a subpatcher reaches this document as one `sub` per frame. Folded
      // into the previous `sub` for the same box only when that is the LAST op so far:
      // a port change brackets its `sub` with this box's cords coming off and going back
      // on, and hoisting a later `sub` above those would replay the cords against the
      // wrong port layout on undo.
      const last = merged[merged.length - 1];
      if (last && last.t === 'sub' && last.id === op.id) {
        merged[merged.length - 1] = {
          t: 'sub',
          id: op.id,
          from: last.from,
          to: op.to,
          ops: mergeMoves(last.ops, op.ops),
        };
      } else {
        merged.push(op);
      }
      continue;
    }
    if (op.t !== 'set-rect') {
      merged.push(op);
      continue;
    }
    const at = merged.findIndex((p) => p.t === 'set-rect' && p.id === op.id);
    const first = at >= 0 ? merged[at] : undefined;
    if (first && first.t === 'set-rect') {
      merged[at] = { t: 'set-rect', id: op.id, from: first.from, to: op.to };
    } else {
      merged.push(op);
    }
  }
  return merged;
}

export class PatchDoc {
  /**
   * The patcher dict minus boxes/lines — canvas size, fonts, appversion, … Owned by the
   * document (copied in, never aliased to the caller's patch) and passed through to
   * toIR() untouched, so a file's header survives an editing session unchanged.
   */
  header: Record<string, unknown>;

  // Every id ever used, in birth order; `live` is the subset that currently exists.
  // See the ordering note in the module header for why removal doesn't drop the slot.
  private slots = new Map<string, IRNode>();
  private live = new Set<string>();
  private edgeSlots = new Map<string, IREdge>();
  private liveEdges = new Set<string>();

  private nextId = 1;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private listeners = new Set<DocListener>();
  private rev = 0;

  // Change-feed serialization. A listener may open a transaction of its own, which
  // commits (and emits) re-entrantly; the queue keeps every listener seeing every op
  // list in commit order. See emit().
  private emitQueue: { ops: readonly Op[]; source: DocSource }[] = [];
  private emitting = false;

  // Open-transaction state. `depth` > 0 means a transact() is in progress; only the
  // outermost one commits, which is how nesting flattens.
  private depth = 0;
  private pending: Op[] = [];
  private pendingLabel = '';
  /** Set by moveNodes for the transaction it is about to open; consumed by commit(). */
  private coalesceRequest: string | undefined;
  /** The coalesce key of the entry currently on top of the undo stack, if any. */
  private coalesceKey: string | undefined;
  /** Set by mergeNext for the transaction it is about to open; consumed by commit(). */
  private mergeRequest: { label?: string } | undefined;

  private readonly tx: Tx;

  /**
   * Set on a document opened with openSubpatch(): the document that owns the box this one
   * is the inside of. Null for a top-level document. See openSubpatch().
   */
  private upstream: { parent: PatchDoc; id: string; detach: () => void } | null = null;
  /** >0 while this document's own commit is being written into its parent. */
  private forwarding = 0;

  private constructor(header?: Record<string, unknown>) {
    this.header = { ...(header ?? {}) };
    // One Tx object for the doc's whole life: it is a façade over the open transaction,
    // and transact() is what decides which transaction that is. Arrow functions rather
    // than a class, so it can reach these private fields without widening them.
    this.tx = {
      apply: (op: Op) => {
        if (this.depth === 0) {
          throw new Error('PatchDoc: tx.apply() called outside its transact() callback');
        }
        this.applyOp(op);
        this.pending.push(op);
      },
      ops: () => this.pending,
      setLabel: (label: string) => {
        this.pendingLabel = label;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // construction
  // ---------------------------------------------------------------------------

  /** An empty document. See create() before calling addBox/setBoxText on it. */
  static empty(header?: Record<string, unknown>): PatchDoc {
    return new PatchDoc(header);
  }

  /**
   * A document over an already-parsed patch. The nodes and edges are adopted as they
   * are — the parser's arity is the file's arity, and re-deriving it here would rewrite
   * boxes the user never touched.
   *
   * Duplicate cords collapse: edges are keyed by edgeKey, one cord per (outlet, inlet)
   * pair, the same rule addEdge enforces. Max's editor cannot create a duplicate either.
   *
   * A cord whose endpoint box isn't in the patch is DROPPED here, and that is a
   * correctness requirement rather than tidiness. The parser emits such an edge by
   * design (maxpat.ts resolves each endpoint with `byId.get(id)` and tolerates a miss,
   * so a hand-edited file, a box removed by another tool, or a box with a non-string id
   * all produce one), and a phantom id is the one id a renumber cannot rename: reorder's
   * map only covers live boxes, so the cord would keep `obj-1` while a real box was
   * being renamed ONTO `obj-1`. The phantom would silently re-attach to that box — or,
   * if it collided with the renamed key of a real cord, evict it — turning a file that
   * parsed silent into one that saves audible. Dropping it at the boundary also stops
   * the writer emitting a patchline to a box that does not exist.
   */
  static fromIR(patch: IRPatch): PatchDoc {
    const doc = new PatchDoc(patch.header);
    let maxId = 0;
    for (const node of patch.nodes) {
      doc.slots.set(node.id, node);
      doc.live.add(node.id);
      const m = ID_SUFFIX.exec(node.id);
      if (m) maxId = Math.max(maxId, Number(m[1]));
    }
    for (const edge of patch.edges) {
      if (!doc.live.has(edge.from.id) || !doc.live.has(edge.to.id)) continue;
      const key = edgeKey(edge);
      if (doc.liveEdges.has(key)) continue;
      doc.edgeSlots.set(key, edge);
      doc.liveEdges.add(key);
    }
    doc.nextId = maxId + 1;
    return doc;
  }

  /**
   * The factories the patcher should use: they wait for generated/boxspecs.json.
   *
   * resolveBox() works without it, but at reduced fidelity — the 46 objects whose arity
   * depends on their arguments (unpack, trigger, route, pack, matrix~, …) fall back to
   * their default box's inlet/outlet counts. A box created that way would silently be
   * the wrong SHAPE: `unpack 1 2 3` would offer two outlets, the user's third cord would
   * be refused as out of range, and nothing later would repair it. So the async factory
   * is the supported path, and addBox/setBoxText throw rather than guess when the table
   * is missing. Both are idempotent — loadBoxSpecs() caches — and cost nothing on the
   * second call, so a caller with no idea whether specs are loaded can just await.
   */
  static async create(header?: Record<string, unknown>): Promise<PatchDoc> {
    await loadBoxSpecs();
    return PatchDoc.empty(header);
  }

  /** fromIR(), having awaited the box specs. See create(). */
  static async open(patch: IRPatch): Promise<PatchDoc> {
    await loadBoxSpecs();
    return PatchDoc.fromIR(patch);
  }

  // ---------------------------------------------------------------------------
  // reading
  // ---------------------------------------------------------------------------

  /**
   * Bumped once per transaction — not once per op — plus once per undo and once per
   * redo. A view can cache on it and know that an unchanged revision means an unchanged
   * document.
   */
  get revision(): number {
    return this.rev;
  }

  get nodeCount(): number {
    return this.live.size;
  }

  get edgeCount(): number {
    return this.liveEdges.size;
  }

  /** Live boxes in creation order (file order, for a parsed patch). */
  *nodes(): IterableIterator<IRNode> {
    for (const [id, node] of this.slots) if (this.live.has(id)) yield node;
  }

  /** Live cords in creation order. */
  *edges(): IterableIterator<IREdge> {
    for (const [key, edge] of this.edgeSlots) if (this.liveEdges.has(key)) yield edge;
  }

  node(id: string): IRNode | undefined {
    return this.live.has(id) ? this.slots.get(id) : undefined;
  }

  /** One cord by its edgeKey — the same key the engine stores it under. */
  edge(key: string): IREdge | undefined {
    return this.liveEdges.has(key) ? this.edgeSlots.get(key) : undefined;
  }

  /** Every cord touching this box, in either direction. */
  edgesOf(id: string): IREdge[] {
    const out: IREdge[] = [];
    for (const edge of this.edges()) {
      if (edge.from.id === id || edge.to.id === id) out.push(edge);
    }
    return out;
  }

  /**
   * The document as an IRPatch, for the engine, the renderer and the writer.
   *
   * A view, not a copy: the nodes and edges are the document's own objects, which is
   * safe precisely because nothing ever mutates one in place. Treat the result as
   * read-only — including `header`, which is the live one.
   */
  toIR(): IRPatch {
    const nodes = [...this.nodes()];
    return {
      nodes,
      edges: [...this.edges()],
      byId: new Map(nodes.map((n) => [n.id, n])),
      header: this.header,
    };
  }

  // ---------------------------------------------------------------------------
  // transactions
  // ---------------------------------------------------------------------------

  /**
   * Run `fn` as one edit: one undo entry, one listener call, one revision bump.
   *
   * Nested transacts FLATTEN into the outermost one (the outer label wins), so a
   * compound gesture can be written as a sequence of the primitives below without the
   * user having to press Cmd-Z once per primitive.
   *
   * A transaction that applies no ops is not an edit: no undo entry, no notification,
   * no revision bump, and the redo stack is left alone. A transaction whose callback
   * throws is rolled back op by op and the error is rethrown, so a half-applied edit can
   * never reach the engine.
   */
  transact<T>(label: string, fn: (tx: Tx) => T): T {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn(this.tx);
      } finally {
        this.depth--;
      }
    }

    this.depth = 1;
    this.pending = [];
    this.pendingLabel = label;
    try {
      const result = fn(this.tx);
      // Closed before committing so that a listener is free to open a transaction of
      // its own (it lands as a separate edit, which is the honest thing for it to be).
      this.depth = 0;
      this.commit();
      return result;
    } catch (err) {
      this.depth = 0;
      this.rollback();
      throw err;
    }
  }

  private commit(): void {
    const ops = this.pending;
    this.pending = [];
    const request = this.coalesceRequest;
    this.coalesceRequest = undefined;

    // Nothing happened. Notably this leaves `coalesceKey` AND a pending mergeNext alone,
    // so a zero-delta step in the middle of a drag doesn't split it into two undo
    // entries, and a mergeNext() whose edit turned out to be a no-op still applies to
    // the edit the caller actually meant.
    if (ops.length === 0) return;

    const merge = this.mergeRequest;
    this.mergeRequest = undefined;

    if (this.upstream) {
      // A subpatcher's document keeps no undo stack of its own: the edit becomes ONE
      // `sub` op in its parent's transaction (and so, recursively, one entry on the top
      // document's stack), and only then is it announced here. Parent first is the
      // order that works: the engine listens to the TOP document, so by the time this
      // document's view hears about a new box, the nested engine has already built it
      // and widgetFor() has a widget to hand back.
      this.rev++;
      this.forwarding++;
      try {
        this.upstream.parent.acceptSub(this.upstream.id, this, ops, this.pendingLabel, request, merge);
      } finally {
        this.forwarding--;
      }
      this.emit(ops, 'apply');
      return;
    }

    const top = this.undoStack[this.undoStack.length - 1];
    if (top && (merge !== undefined || (request !== undefined && this.coalesceKey === request))) {
      top.ops = mergeMoves(top.ops, ops);
      if (merge?.label !== undefined) top.label = merge.label;
    } else {
      this.undoStack.push({ label: this.pendingLabel, ops });
    }
    this.coalesceKey = request; // any non-coalescing edit breaks the chain

    this.redoStack.length = 0;
    this.rev++;
    // The NEW ops, even when they were merged into an existing entry: the undo stack
    // didn't grow but the document did change, and the engine still has to follow.
    this.emit(ops, 'apply');
  }

  private rollback(): void {
    const ops = this.pending;
    this.pending = [];
    this.coalesceRequest = undefined;
    for (let i = ops.length - 1; i >= 0; i--) this.applyOp(invert(ops[i]));
  }

  // ---------------------------------------------------------------------------
  // editing
  // ---------------------------------------------------------------------------

  /**
   * Create a box from a line of text at (x, y) and return it.
   *
   * The text goes through resolveBox, so the box arrives with its real class, arity,
   * outlet types and domains — `t b f` gets two outlets typed bang/float, not one. The
   * resolved default box dict is kept as `raw` so that saving a patch built here writes
   * the same colours, fonts and Max-only keys a box created in Max would have.
   */
  addBox(text: string, x: number, y: number): IRNode {
    this.requireSpecs();
    const spec = resolveBox(text, [x, y]);
    const node = specToNode(spec, this.mintId());
    if (Object.keys(spec.box).length > 0) node.raw = spec.box;
    this.transact(`Add ${spec.name || 'box'}`, (tx) => tx.apply({ t: 'add-node', node }));
    return node;
  }

  /**
   * Retype a box in place, and deal with what that does to its cords.
   *
   * Everything happens in ONE transaction, so a single Cmd-Z takes all of it back, and
   * the op list is ordered so that it is a complete instruction on its own — a listener
   * (Phase 5's Engine.applyOps) never has to go back and ask the document what else
   * changed:
   *
   *   1. EVERY cord touching the box is removed, not just the ones the new arity
   *      invalidates. `set-box` is the one op that re-instantiates an object, and a
   *      re-instantiated object's connections are all gone whether or not the document
   *      still lists them. An op list that mentioned only the orphans would leave the
   *      engine holding cords into a disposed node — silently, and until the next full
   *      build().
   *   2. The box is replaced.
   *   3. Every cord that survives is re-added, against the new box, carrying the domain
   *      its outlet now has: retyping `cycle~ 440` to `+ 1` turns a signal cord into a
   *      control one, and the engine wires the two transports differently.
   *
   * The order matters in both directions. Forward, no cord ever names a port that isn't
   * there: the cords come off while the old box is still the old box, and go back on
   * only once the new one exists. Undo runs the inverses in reverse and gets the mirror
   * image of the same sequence. A cord hanging off a port the new arity does not have is
   * simply never re-added — that is the invariant that keeps the document and the engine
   * from disagreeing about a cord that cannot exist.
   *
   * An UNRECOGNIZED name is not treated as an arity of zero. resolveBox reports 0 in / 0
   * out for a name no object has, which is a statement about this app's catalog and not
   * about the box, so adopting it would amputate every cord on the box the moment the
   * user mistyped one character — and correcting the typo would not bring them back,
   * because by then the document no longer has them. `p` (Max's own abbreviation for
   * `patcher`, whose real arity comes from the nested patcher's inlet/outlet objects,
   * which this IR does not model) is permanently in that category, so renaming any
   * subpatcher would sever it from its patch. The box keeps its ports, is marked
   * `known: false` for the dashed-red treatment, and its cords are left alone.
   *
   * The box keeps its position and re-fits its width to the new text, as Max does.
   * (Resize is deliberately not modelled at all this pass: maxpylang has no public API
   * for box width, so a resized box could not be expressed in generated MaxPy.)
   */
  setBoxText(id: string, text: string): void {
    this.requireSpecs();
    const prev = this.node(id);
    if (!prev || prev.text === text) return;

    const spec = resolveBox(text, [prev.rect[0], prev.rect[1]]);
    const next = specToNode(spec, id);
    next.rect = [prev.rect[0], prev.rect[1], spec.rect[2], spec.rect[3]];
    if (!spec.known) {
      // See the note above: keep the shape we know rather than the zero we inferred.
      next.numInlets = prev.numInlets;
      next.numOutlets = prev.numOutlets;
      next.outletDomains = [...prev.outletDomains];
      if (prev.outletTypes) next.outletTypes = [...prev.outletTypes];
      else delete next.outletTypes;
    }
    // Keep the old box's Max-only keys while it is still the same kind of box; a class
    // change makes them meaningless (a toggle's saved attributes on a cycle~), so the
    // new class's own default dict takes over.
    const raw = spec.maxclass === prev.maxclass ? prev.raw : spec.box;
    if (raw && Object.keys(raw).length > 0) next.raw = raw;

    this.transact(`Retype ${spec.name || 'box'}`, (tx) => {
      const survivors: IREdge[] = [];
      // Snapshot before applying anything: the ops below mutate the live-edge set.
      for (const edge of this.edgesOf(id)) {
        tx.apply({ t: 'remove-edge', edge });
        const orphaned =
          (edge.from.id === id && edge.from.outlet >= next.numOutlets) ||
          (edge.to.id === id && edge.to.inlet >= next.numInlets);
        if (orphaned) continue;
        const domain =
          edge.from.id === id ? (next.outletDomains[edge.from.outlet] ?? 'control') : edge.domain;
        // Reuse the very same object when nothing about the cord changed, so a retype
        // that only touches an argument leaves toIR() deep-equal by reference.
        survivors.push(domain === edge.domain ? edge : { ...edge, domain });
      }
      tx.apply({ t: 'set-box', id, from: prev, to: next });
      for (const edge of survivors) tx.apply({ t: 'add-edge', edge });
    });
  }

  /**
   * Translate boxes by (dx, dy).
   *
   * `coalesce` merges this move into the previous undo entry when it moved the same set
   * of boxes, which is what makes a 60-frame drag one Cmd-Z instead of sixty. It is an
   * explicit flag from the caller rather than a wall-clock heuristic on purpose: the
   * pointer controller knows exactly when a drag starts and ends (pointerdown …
   * pointermove … pointerup), so guessing from timestamps would only add a way to be
   * wrong. Pass `true` on EVERY frame, the first included, and call endCoalesce() on
   * pointerup: a first frame passing `false` would leave `coalesceKey === undefined`,
   * so the second frame — the first coalescing one — would find no matching entry to
   * merge into and would push a second one, giving two undo entries per drag.
   *
   * A zero-delta move applies nothing and is not an edit.
   */
  moveNodes(ids: Iterable<string>, dx: number, dy: number, coalesce = false): void {
    const list = [...ids];
    // Coalescing only makes sense when this call owns the undo entry; inside a caller's
    // transaction the entry is theirs and already covers the whole gesture.
    if (coalesce && this.depth === 0) this.coalesceRequest = moveKey(list);
    this.transact(list.length === 1 ? 'Move' : `Move ${list.length} boxes`, (tx) => {
      if (dx === 0 && dy === 0) return;
      for (const id of list) {
        const node = this.node(id);
        if (!node) continue;
        const from: Rect = [...node.rect];
        const to: Rect = [node.rect[0] + dx, node.rect[1] + dy, node.rect[2], node.rect[3]];
        tx.apply({ t: 'set-rect', id, from, to });
      }
    });
  }

  /**
   * End the current run of coalescing moves, so the NEXT one opens a fresh undo entry.
   *
   * Without this nothing can close a run: two separate drags of the same selection with
   * no other edit between them produce the same coalesce key, so the second would merge
   * into the first and one Cmd-Z would take back both. The controller calls it on
   * pointerup — the only moment that knows a gesture is over.
   */
  endCoalesce(): void {
    // The run being ended lives on the stack that recorded it, which for a subpatcher
    // is the top document's.
    if (this.upstream) this.root().endCoalesce();
    else this.coalesceKey = undefined;
  }

  /**
   * Fold the NEXT transaction into the undo entry already on top of the stack, instead
   * of pushing a new one — one gesture, one Cmd-Z, even when the gesture reaches the
   * document more than once.
   *
   * Typing a box in the patcher is what needs it: addBox() puts an empty box on the
   * canvas for the editor to sit on, and setBoxText() names it. As two entries, Cmd-Z
   * after typing `cycle~ 440` left an empty box behind instead of removing it, which is
   * not what Max does. Passing `label` renames the merged entry, which is how "Add box"
   * becomes "New object" once the box has a name. (The other compound gesture, an
   * Option-drag, uses beginCoalesce() below, because there the merge should happen only
   * if the boxes really are the ones the duplicate just made.)
   *
   * The request survives a transaction that applies no ops, and is spent by the first
   * one that does. It is a request rather than a mode because nothing may accidentally
   * swallow a LATER edit into the same entry.
   */
  mergeNext(label?: string): void {
    this.mergeRequest = { label };
  }

  /**
   * Reverse the top undo entry and forget it ever happened: no redo entry, no trace.
   *
   * For a gesture that was never an edit. Double-clicking the canvas creates an empty
   * box for the editor to sit on; pressing Escape has to take it away again, and doing
   * that with removeNodes() left TWO entries on the stack, so the next Cmd-Z resurrected
   * a phantom empty box instead of reaching the user's last real edit. Returns false
   * when the stack is empty, so a caller can fall back to an ordinary delete.
   *
   * Deliberately narrow: the caller has to know that the top entry is its own (the
   * patcher checks `revision`), because this reverses whatever is there.
   */
  rollbackLast(): boolean {
    this.assertIdle('rollbackLast');
    if (this.upstream) return this.topReaches('undo') && this.root().rollbackLast();
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const inverse = entry.ops.map(invert).reverse();
    for (const op of inverse) this.applyOp(op);
    this.coalesceKey = undefined;
    this.rev++;
    // 'undo' rather than a new source tag: to every listener this IS an undo — the same
    // op shapes, already applied, in the same order. The only difference is bookkeeping
    // the listeners cannot see.
    this.emit(inverse, 'undo');
    return true;
  }

  /**
   * Re-open the run of coalescing moves that `ids` belong to, so the next coalescing
   * moveNodes() of exactly those boxes merges into the entry now on top of the stack
   * rather than pushing its own. The seam an Option-drag needs: duplicate() commits its
   * own transaction first, and that commit clears the coalesce key.
   */
  beginCoalesce(ids: Iterable<string>): void {
    this.setCoalesceKey(moveKey([...ids]));
  }

  /** Arm a coalesce run on whichever document keeps the undo stack. */
  private setCoalesceKey(key: string): void {
    if (this.upstream) this.upstream.parent.setCoalesceKey(subKey(this.upstream.id, key));
    else this.coalesceKey = key;
  }

  /**
   * Delete boxes and every cord touching them.
   *
   * The cords go first. Replayed forward, that means a cord is never left pointing at a
   * box that is already gone; replayed backward (undo runs the inverses in reverse), the
   * box is restored before its cords are re-made. Either direction is consistent at
   * every intermediate step, which is what lets the engine apply an op list one op at a
   * time without ever seeing an impossible state.
   */
  removeNodes(ids: Iterable<string>): void {
    const set = new Set(ids);
    const label = set.size === 1 ? 'Delete box' : `Delete ${set.size} boxes`;
    this.transact(label, (tx) => {
      // Snapshot: applying the ops mutates the live-edge set underneath this loop.
      for (const edge of [...this.edges()]) {
        if (set.has(edge.from.id) || set.has(edge.to.id)) tx.apply({ t: 'remove-edge', edge });
      }
      for (const id of set) {
        const node = this.node(id);
        if (node) tx.apply({ t: 'remove-node', node });
      }
    });
  }

  /**
   * Connect an outlet to an inlet, or return null.
   *
   * Null rather than an exception because every one of these cases is something a user
   * does by hand a dozen times an hour — dropping a cord on a box's body, re-drawing a
   * cord that already exists, releasing on a port that shrank away mid-gesture. The
   * gesture should simply not produce a cord; it is not an error condition.
   *
   * The richer ok/warn/refuse judgement (signal into a control-only inlet, video across
   * transports) is ir/connect.ts's job in Phase 5. This is only the structural floor:
   * the ports have to exist and the cord must not already.
   */
  addEdge(from: IREdge['from'], to: IREdge['to']): IREdge | null {
    const src = this.node(from.id);
    const dst = this.node(to.id);
    if (!src || !dst) return null;
    if (!Number.isInteger(from.outlet) || from.outlet < 0 || from.outlet >= src.numOutlets) {
      return null;
    }
    if (!Number.isInteger(to.inlet) || to.inlet < 0 || to.inlet >= dst.numInlets) return null;

    const edge: IREdge = {
      from: { id: from.id, outlet: from.outlet },
      to: { id: to.id, inlet: to.inlet },
      domain: src.outletDomains[from.outlet] ?? 'control',
    };
    if (this.edge(edgeKey(edge))) return null;

    this.transact('Connect', (tx) => tx.apply({ t: 'add-edge', edge }));
    return edge;
  }

  /** Cut one cord by its edgeKey. Unknown keys are a no-op, for the same reason as above. */
  removeEdge(key: string): void {
    const edge = this.edge(key);
    if (!edge) return;
    this.transact('Disconnect', (tx) => tx.apply({ t: 'remove-edge', edge }));
  }

  /**
   * The dense `obj-1..obj-N` id map for the live boxes — computed, NOT applied.
   *
   * This is what SAVE AND CODEGEN want, and reorder() below is not. A generated MaxPy
   * script re-run from scratch produces obj-1..obj-N, and a .maxpat should not show the
   * holes a session's monotonic ids leave behind, so both need dense names at the moment
   * they write. Neither needs the document to change: patchToMaxPat already takes a
   * `renumber` option and applies exactly this map to its own output, and codegen can
   * name its variables from it the same way. Serializing a document is not an edit to
   * it.
   *
   * Pure. Same result as the map reorder() returns, with no op, no undo entry, no
   * notification and no revision bump.
   */
  denseIdMap(): Record<string, string> {
    const map: Record<string, string> = {};
    let n = 1;
    for (const node of this.nodes()) map[node.id] = `obj-${n++}`;
    return map;
  }

  /**
   * Renumber the live boxes densely, `obj-1..obj-N` in creation order, and return the
   * old-id -> new-id map.
   *
   * This is maxpylang's reorder(): the document really is rewritten, every cord
   * endpoint with it. It is NOT how ids are managed while editing — during a session
   * they are monotonic and never reused (see mintId) — which is exactly why this is an
   * explicit call and an undoable op rather than a side effect of anything.
   *
   * IT IS AN EDIT, with everything that implies: it costs the user a Cmd-Z, and
   * committing it clears the redo stack, so a pending Cmd-Shift-Z is gone. A save or a
   * debounced codegen regeneration must therefore NOT call it — "I pressed ⌘S and my
   * next ⌘Z did nothing visible, and my redo vanished" is the bug that follows. Use
   * denseIdMap() above (with patchToMaxPat's `renumber` option) for anything on the
   * serialization path; call this one only when densifying the document is itself the
   * user's intent.
   *
   * Being an op rather than a side effect is also what keeps the ids safe. The minting
   * counter is deliberately not rewound: it only ever moves forward, so no name it hands
   * out later can collide with one it has already handed out. The names this call
   * reassigns can be, but only underneath the renumber op itself — and undo is strictly
   * LIFO, so reaching a record that mentions an old name means having already undone the
   * renumber that took it away. That argument is the reason a non-undoable variant of
   * this method is not offered: it would leave every older undo record naming ids the
   * document had moved somewhere else.
   *
   * The permutation covers the slots of DELETED boxes too — they are numbered after the
   * live ones and are not in the returned map, which is about boxes. That is not
   * bookkeeping for its own sake. A renumber that dropped them would make the op lossy
   * in a way neither direction could repair: rollback() replays the inverse and would
   * silently discard where those boxes used to sit, so a later undo of the delete would
   * bring the box back at the END of the box order and a save would reshuffle the file's
   * boxes array. Covering them keeps the op a true bijection, and keeps the ordering
   * guarantee in the module header intact across a renumber.
   */
  reorder(): Record<string, string> {
    const boxes = this.denseIdMap();
    const map = { ...boxes };
    let n = Object.keys(boxes).length + 1;
    let changed = Object.entries(boxes).some(([from, to]) => from !== to);
    for (const id of this.slots.keys()) {
      if (this.live.has(id)) continue;
      const to = `obj-${n++}`;
      map[id] = to;
      if (to !== id) changed = true;
    }
    if (changed) {
      const op: Op = { t: 'renumber', map, edgeMap: this.edgeRenameMap(map) };
      this.transact('Renumber', (tx) => tx.apply(op));
    }
    return boxes;
  }

  // ---------------------------------------------------------------------------
  // subpatchers
  // ---------------------------------------------------------------------------

  /**
   * A document for the inside of the `p`/`patcher` box `id`, for editing in place.
   *
   * It is a full PatchDoc — addBox, setBoxText, cords, moves, paste, all of it — built
   * from the box's embedded `patcher` dict, with one difference: it keeps NO undo stack.
   * Each transaction it commits is written into this document as a single `sub` op (see
   * ops.ts), carrying the inner ops and the box rewritten to hold the new inner patch.
   * So the edit is part of this document the moment it is made: Save, Share, autosave
   * and codegen of the top document all see it, and the engine, which follows the top
   * document, forwards the inner ops to the nested engine running the box.
   *
   * THE UNDO DESIGN, and why it is this one. There is exactly ONE history — the top
   * document's — and an edit inside a subpatcher is one entry on it. The alternative,
   * a stack per open subpatcher, gives two histories that can each take back the same
   * change: undo it inside, close the window, and the parent's stack still holds the
   * edit (or its reversal as a second edit), and the two drift the moment either is
   * used without the other. With one history there is nothing to reconcile: undoing
   * from the parent replays the inverse inner ops into whichever subpatcher document is
   * open (via the subscription below), exactly as a local undo would, and every entry
   * is reversible whether or not the subpatcher is open at the time. What would make it
   * feel wrong — Cmd-Z inside a subpatcher undoing something in the parent the user
   * cannot see — is ruled out in undo(): inside, only an entry that reaches this
   * subpatcher is taken back.
   *
   * Ids are safe across close-and-reopen for the reason reorder() gives: the child is
   * rebuilt from the box each time it is opened, so its minting counter restarts from
   * the live ids, but undo is strictly LIFO — any record naming a box that has since
   * been deleted is only reachable after every later edit (including any that reused
   * the name) has been undone.
   *
   * Call close() on the result when the view on it goes away.
   */
  openSubpatch(id: string): PatchDoc {
    const node = this.node(id);
    if (!node || !isSubpatcher(node)) throw new Error(`PatchDoc: ${id} is not a subpatcher box`);
    const child = PatchDoc.fromIR(innerPatch(node));
    const detach = this.on((ops, source) => {
      // An edit the child made itself is already applied there; anything else that
      // reaches its box — an undo or redo from any level — is replayed into it.
      if (child.forwarding > 0 && source === 'apply') return;
      for (const op of ops) if (op.t === 'sub' && op.id === id) child.receive(op.ops, source);
    });
    child.upstream = { parent: this, id, detach };
    return child;
  }

  /** The box this document is the inside of, or null at the top level. */
  get subpatchOf(): { parent: PatchDoc; id: string } | null {
    return this.upstream ? { parent: this.upstream.parent, id: this.upstream.id } : null;
  }

  /** Stop following the parent. The document stays readable; edits go nowhere. */
  close(): void {
    this.upstream?.detach();
    this.upstream = null;
  }

  /** The document holding the undo stack. */
  private root(): PatchDoc {
    let doc: PatchDoc = this;
    while (doc.upstream) doc = doc.upstream.parent;
    return doc;
  }

  /** Box ids from the root down to this document. */
  private path(): string[] {
    const out: string[] = [];
    for (let doc: PatchDoc = this; doc.upstream; doc = doc.upstream.parent) out.unshift(doc.upstream.id);
    return out;
  }

  /** Is the root's next undo (or redo) an edit made in this subpatcher or below it? */
  private topReaches(which: 'undo' | 'redo'): boolean {
    const root = this.root();
    const stack = which === 'undo' ? root.undoStack : root.redoStack;
    const entry = stack[stack.length - 1];
    return !!entry && reaches(entry.ops, this.path());
  }

  /**
   * One transaction from a subpatcher document, written into this one as a `sub`.
   *
   * When the inner inlets/outlets moved, the box's cords come off before the `sub` and
   * the survivors go back on after it — setBoxText's bracket, for setBoxText's reason:
   * the engine re-makes the box's port relays in between, so a cord left in place would
   * stay wired to a relay that no longer exists. A cord on a port the box no longer has
   * is not re-added, and that is the one way an edit inside a subpatcher removes a cord
   * out here — which is Max's behaviour when you delete an inlet.
   */
  private acceptSub(
    id: string,
    child: PatchDoc,
    ops: readonly Op[],
    label: string,
    request: string | undefined,
    merge: { label?: string } | undefined,
  ): void {
    const prev = this.node(id);
    if (!prev) return;
    const { node: next, rewire } = writeBack(prev, child.toIR(), ops);
    if (request !== undefined && this.depth === 0) this.coalesceRequest = subKey(id, request);
    if (merge !== undefined) this.mergeRequest = merge;
    this.transact(label, (tx) => {
      const sub: Op = { t: 'sub', id, from: prev, to: next, ops: [...ops] };
      if (!rewire) {
        tx.apply(sub);
        return;
      }
      const survivors: IREdge[] = [];
      for (const edge of this.edgesOf(id)) {
        tx.apply({ t: 'remove-edge', edge });
        const orphaned =
          (edge.from.id === id && edge.from.outlet >= next.numOutlets) ||
          (edge.to.id === id && edge.to.inlet >= next.numInlets);
        if (orphaned) continue;
        const domain =
          edge.from.id === id ? (next.outletDomains[edge.from.outlet] ?? 'control') : edge.domain;
        survivors.push(domain === edge.domain ? edge : { ...edge, domain });
      }
      tx.apply(sub);
      for (const edge of survivors) tx.apply({ t: 'add-edge', edge });
    });
  }

  /**
   * Apply ops that were already recorded elsewhere — an undo or redo on the top
   * document reaching this subpatcher — and announce them under the same source. No
   * undo entry: the entry lives where it was recorded.
   */
  private receive(ops: readonly Op[], source: DocSource): void {
    for (const op of ops) this.applyOp(op);
    this.rev++;
    this.emit(ops, source);
  }

  // ---------------------------------------------------------------------------
  // undo / redo
  // ---------------------------------------------------------------------------

  get canUndo(): boolean {
    if (this.upstream) return this.topReaches('undo');
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    if (this.upstream) return this.topReaches('redo');
    return this.redoStack.length > 0;
  }

  /** Label of the edit Cmd-Z would take back, for the menu item. */
  get undoLabel(): string | undefined {
    if (this.upstream) return this.topReaches('undo') ? this.root().undoLabel : undefined;
    return this.undoStack[this.undoStack.length - 1]?.label;
  }

  /**
   * Undo the last edit: its ops inverted, applied in reverse.
   *
   * Inside a subpatcher, only an edit made in THIS subpatcher (or one nested in it) is
   * taken back; Cmd-Z there does nothing once those run out, rather than reaching past
   * them and silently undoing something in a window the user is not looking at. From
   * the parent, the same edits are ordinary undo steps. See openSubpatch().
   */
  undo(): void {
    this.assertIdle('undo');
    if (this.upstream) {
      if (this.topReaches('undo')) this.root().undo();
      return;
    }
    const entry = this.undoStack.pop();
    if (!entry) return;
    const inverse = entry.ops.map(invert).reverse();
    for (const op of inverse) this.applyOp(op);
    this.redoStack.push(entry);
    this.coalesceKey = undefined;
    this.rev++;
    this.emit(inverse, 'undo');
  }

  /** Redo the last undone edit: its original ops, applied in order. */
  redo(): void {
    this.assertIdle('redo');
    if (this.upstream) {
      if (this.topReaches('redo')) this.root().redo();
      return;
    }
    const entry = this.redoStack.pop();
    if (!entry) return;
    for (const op of entry.ops) this.applyOp(op);
    this.undoStack.push(entry);
    this.coalesceKey = undefined;
    this.rev++;
    this.emit(entry.ops, 'redo');
  }

  // ---------------------------------------------------------------------------
  // notification
  // ---------------------------------------------------------------------------

  /** Subscribe to the change feed. Returns the unsubscribe thunk. */
  on(fn: DocListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Deliver one transaction's ops to every listener, in commit order.
   *
   * The queue is what makes "in commit order" true. transact() deliberately closes the
   * transaction before notifying, so a listener may open one of its own (an auto-connect
   * rule, a validator that calls undo()) — and that nested edit commits, and emits,
   * while this loop is only part-way through the listener list. Delivering it
   * immediately would hand every listener registered AFTER the mutating one the nested
   * transaction's ops before the outer one's: an engine that replays the feed verbatim
   * would see `add-edge obj-1:0>obj-2:0` before obj-1 exists, drop the cord, and never
   * be told again. So a re-entrant emit only enqueues; the outermost call drains, giving
   * each op list to every listener in full before starting the next.
   */
  private emit(ops: readonly Op[], source: DocSource): void {
    this.emitQueue.push({ ops, source });
    if (this.emitting) return;
    this.emitting = true;
    try {
      // Not a for-of: a listener may append to the queue while it is being drained.
      while (this.emitQueue.length > 0) {
        const next = this.emitQueue.shift()!;
        // Snapshot the set: a listener is allowed to unsubscribe (or subscribe) from
        // inside its own callback, and a listener that throws must not stop the others
        // from being told. The document is already consistent by this point, so there is
        // nothing to roll back — the failure belongs to the listener.
        for (const fn of [...this.listeners]) {
          try {
            fn(next.ops, next.source);
          } catch (err) {
            console.error('PatchDoc listener failed:', err);
          }
        }
      }
    } finally {
      // Only reachable if the loop itself threw (console.error can), and leaving the
      // flag set would mute the document for the rest of its life.
      this.emitting = false;
      this.emitQueue.length = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private requireSpecs(): void {
    if (boxSpecs()) return;
    throw new Error(
      'PatchDoc: generated/boxspecs.json is not loaded. Build the document with ' +
        'PatchDoc.create()/PatchDoc.open(), or await loadBoxSpecs() first. Resolving box ' +
        'text without it would give the 46 argument-dependent objects (unpack, trigger, ' +
        'route, pack, …) the wrong number of ports, and no later load would repair the ' +
        'cords refused in the meantime.',
    );
  }

  /**
   * The next never-before-used box id.
   *
   * `slots` remembers every id the document has ever held, deleted ones included, so the
   * loop also covers a patch whose file ids skipped around. Monotonic and never reused:
   * an undo record that still names `obj-4` must never find a different box there.
   */
  private mintId(): string {
    let id = `obj-${this.nextId++}`;
    while (this.slots.has(id)) id = `obj-${this.nextId++}`;
    return id;
  }

  private assertIdle(what: string): void {
    if (this.depth > 0) throw new Error(`PatchDoc: cannot ${what} inside a transaction`);
  }

  /**
   * Apply one op to the stores. The only place the document actually changes.
   *
   * Ops that name a box which isn't there are ignored rather than thrown on: every op
   * the document generates is built against the current state, so this can only happen
   * when an external op list is replayed out of order, and a half-applied replay is
   * worse than a skipped op.
   */
  private applyOp(op: Op): void {
    switch (op.t) {
      case 'add-node':
        // Map.set keeps an existing key's position, so re-adding after an undo puts the
        // box back where it was in the box order rather than at the end.
        this.slots.set(op.node.id, op.node);
        this.live.add(op.node.id);
        return;
      case 'remove-node':
        this.live.delete(op.node.id);
        return;
      case 'set-rect': {
        const node = this.node(op.id);
        if (!node) return;
        this.slots.set(op.id, { ...node, rect: [...op.to] as Rect });
        return;
      }
      case 'set-box': {
        if (!this.live.has(op.id)) return;
        this.slots.set(op.id, op.to.id === op.id ? op.to : { ...op.to, id: op.id });
        return;
      }
      case 'add-edge': {
        const key = edgeKey(op.edge);
        this.edgeSlots.set(key, op.edge);
        this.liveEdges.add(key);
        return;
      }
      case 'remove-edge':
        this.liveEdges.delete(edgeKey(op.edge));
        return;
      case 'renumber':
        this.applyRenumber(op.map);
        return;
      case 'sub': {
        // The box's side of it only: its new `patcher` dict and ports. The inner ops are
        // the business of whoever runs or shows the inside (the engine's nested Engine,
        // an open subpatcher document), and each of those follows them from the feed.
        if (!this.live.has(op.id)) return;
        this.slots.set(op.id, op.to.id === op.id ? op.to : { ...op.to, id: op.id });
        return;
      }
    }
    const unreachable: never = op;
    throw new Error(`PatchDoc: unknown op ${JSON.stringify(unreachable)}`);
  }

  /** One live cord's old edgeKey -> the key it will have under `map`. See ops.ts. */
  private edgeRenameMap(map: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, edge] of this.edgeSlots) {
      if (!this.liveEdges.has(key)) continue;
      out[key] = edgeKey(this.renameEdge(edge, map));
    }
    return out;
  }

  private renameEdge(edge: IREdge, map: Record<string, string>): IREdge {
    return {
      ...edge,
      from: { ...edge.from, id: map[edge.from.id] ?? edge.from.id },
      to: { ...edge.to, id: map[edge.to.id] ?? edge.to.id },
    };
  }

  /**
   * Rebuild both stores under new ids.
   *
   * Everything is rebuilt into fresh Maps rather than renamed in place, because a
   * renumber is a permutation: `obj-3 -> obj-2` while `obj-2 -> obj-1` would collide
   * with itself halfway through an in-place rename.
   *
   * Dead slots and dead edge slots are carried through under their new names rather than
   * dropped, so a renumber loses no history and its inverse restores the document
   * exactly — including where a deleted box used to sit in the box order. reorder()'s
   * map covers them for precisely this reason; see the note there.
   */
  private applyRenumber(map: Record<string, string>): void {
    const rename = (id: string) => map[id] ?? id;

    const slots = new Map<string, IRNode>();
    const live = new Set<string>();
    for (const [id, node] of this.slots) {
      const next = rename(id);
      slots.set(next, next === id ? node : { ...node, id: next });
      if (this.live.has(id)) live.add(next);
    }

    const edgeSlots = new Map<string, IREdge>();
    const liveEdges = new Set<string>();
    for (const [key, edge] of this.edgeSlots) {
      const next = this.renameEdge(edge, map);
      const nextKey = edgeKey(next);
      edgeSlots.set(nextKey, next);
      if (this.liveEdges.has(key)) liveEdges.add(nextKey);
    }

    this.slots = slots;
    this.live = live;
    this.edgeSlots = edgeSlots;
    this.liveEdges = liveEdges;
  }
}
