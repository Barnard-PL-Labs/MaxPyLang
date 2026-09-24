// The engine: turn an IRPatch into a live Web Audio graph, and then keep it in step
// with the document one edit at a time.
//
// build() is the bulk path — open a file, press ▶ Run — and everything below the
// "incremental editing" heading is the other one. They are not alternatives: build()
// is written in terms of the incremental primitives (its edge loop IS connect()), so a
// patch has exactly one set of wiring rules whether it arrived all at once or a cord at
// a time, and a cord built by build() can be cut by disconnect() afterwards.
//
// The incremental half exists because the product is a live instrument. A canvas that
// rebuilt on every edit would re-instantiate every object and re-create every widget's
// DOM to move one box four pixels: oscillators would click, a slider mid-drag would
// lose its thumb, and Cmd-Z would interrupt the sound. So doc/ops.ts makes each edit a
// command object and applyOps() maps the ones that matter onto the engine — and maps
// `set-rect`, the most frequent edit of all, onto nothing whatsoever.
//
// Cutting a cord is what makes that possible, and each of the three transports is cut
// differently: audio by AudioNode.disconnect, control by the unsubscribe thunk
// onControlOut hands back, video by dropping the entry the rAF pump reads. `cords`
// stores that teardown per cord so the difference is decided once, at connect time.

import type { Op } from '../doc/ops';
import type { PatchDoc } from '../doc/patch-doc';
import type { IREdge, IRNode, IRPatch } from '../ir/types';
import { getFactory, tierOf, type MaxNode, type Tier, type VideoFrame, type VideoSource } from './registry';
import { scheduler } from '../runtime/scheduler';
import { buses } from '../runtime/buses';

export interface BuildReport {
  built: Map<string, MaxNode>;
  implemented: string[]; // Tier B: real behavior
  stubbed: string[]; // Tier A: recognized (correct I/O) but no behavior yet
  unknown: string[]; // not in the manifest at all (e.g. a subpatcher/abstraction)
  videoCords: number; // jit_matrix cords wired between video ports
}

interface VideoEdge {
  source: VideoSource;
  sink: (frame: VideoFrame) => void;
}

/**
 * One cord's identity: source port -> destination port. Cords live in a Map under
 * this key so a single one can be found and removed in O(1) when the patcher cuts
 * it, instead of scanning (or rebuilding) the whole patch.
 */
export function edgeKey(edge: IREdge): string {
  return `${edge.from.id}:${edge.from.outlet}>${edge.to.id}:${edge.to.inlet}`;
}

/** What addNode/replaceNode managed to make of a box. `node` is absent when nothing was. */
export interface NodeResult {
  /** 'B' real behavior, 'A' metadata stub, 'none' no factory at all (subpatcher, typo). */
  tier: Tier;
  node?: MaxNode;
}

export class Engine {
  readonly ctx: BaseAudioContext;
  private nodes = new Map<string, MaxNode>();
  private videoEdges = new Map<string, VideoEdge>();
  /**
   * One teardown thunk per live cord, keyed by edgeKey — how a single cord is cut
   * without touching anything else. The thunk is chosen at connect() time because that
   * is the only moment the transport, the two ports and (for control) the subscription
   * that came back are all in hand; by the time disconnect() is called, the cord is a
   * key and a function and nothing else has to be re-derived.
   */
  private cords = new Map<string, () => void>();
  /**
   * The same keys, with the cord they stand for. removeNode() has to find every cord
   * touching a box, and the alternative — taking an edgeKey apart to read the ids back
   * out — would be a second definition of cord identity, which is exactly what ops.ts
   * re-exports edgeKey to avoid. Written and deleted only in connect()/disconnect(), so
   * it cannot drift from `cords`.
   */
  private cordEdges = new Map<string, IREdge>();
  private rafId: number | null = null;
  // Whether ▶ has been pressed on THIS engine. Tracked per-engine rather than read back
  // off the shared scheduler, because the scheduler is also armed by any other Engine on
  // the page (the offline self-test builds one) and this flag has to mean "my patch is
  // playing", nothing else. build() reads it to bring a rebuilt patch up running.
  private running = false;

  /**
   * True for the engine a subpatcher runs its inner patch on (objects/control/subpatch.ts).
   * It shares its parent's AudioContext and the page's scheduler, so it must never
   * suspend, resume or re-arm either: ▶ and ■ belong to the top-level engine, and a
   * nested start() only starts the nodes it owns.
   */
  private readonly nested: boolean;

  // Accepts a live AudioContext (playback) or an OfflineAudioContext (self-test).
  constructor(ctx?: BaseAudioContext, opts: { nested?: boolean } = {}) {
    this.ctx = ctx ?? new AudioContext();
    this.nested = opts.nested ?? false;
    // A live context starts suspended until a user gesture, so nothing plays
    // until Start is pressed. Offline contexts render on demand instead.
    if (!this.nested && this.ctx instanceof AudioContext) void this.ctx.suspend();
  }

  /** Instantiate every object and connect the cords. Returns what got built. */
  build(patch: IRPatch): BuildReport {
    // Idempotent: building over a live patch replaces it rather than layering a
    // second copy on top (which would double every voice and leak the old nodes).
    this.clear();

    const implemented = new Set<string>();
    const stubbed = new Set<string>();
    const unknown = new Set<string>();

    for (const node of patch.nodes) {
      const factory = getFactory(node.className);
      if (!factory) {
        unknown.add(node.className);
        continue;
      }
      try {
        this.nodes.set(node.id, factory(node.args, { ctx: this.ctx, node }));
        (tierOf(node.className) === 'B' ? implemented : stubbed).add(node.className);
      } catch (err) {
        console.error(`Failed to build ${node.className} (${node.id}):`, err);
        unknown.add(node.className);
      }
    }

    // Through connect(), not inline: a cord made here has to be cuttable by the same
    // disconnect() the patcher calls, which means its teardown thunk has to be recorded
    // the same way. Wiring a file's cords by a second code path is how the two would
    // drift, and the symptom would be a cord the user deletes from the canvas that
    // keeps making sound until the next full build.
    for (const edge of patch.edges) this.connect(edge);

    // node.start/stop are the transport hooks (see start()/stop()). On a FIRST build
    // they stay uncalled: timed control objects (metro, delay) begin only when the user
    // presses ▶, so they stay in sync with when audio actually plays. A rebuild of a
    // patch that is already running is the other case — the transport never stopped, so
    // the replacement must come up running too. Otherwise ▶ Run leaves a half-live patch:
    // an OscillatorNode starts at construction and ezdac~ connects to the destination at
    // construction, so the drones are audible immediately, while nothing is pumping video
    // frames and the metros are silent — with ▶ still lit, so nothing tells the user.
    if (this.running) {
      for (const n of this.nodes.values()) n.start?.();
      this.startFrameLoop();
    }

    return {
      built: this.nodes,
      implemented: [...implemented],
      stubbed: [...stubbed],
      unknown: [...unknown],
      videoCords: this.videoEdges.size,
    };
  }

  // ── Video frame loop ──────────────────────────────────────────────────────
  // A pull-on-rAF pump: each animation frame we read the current frame from every
  // wired video source and hand it to its sink (which draws / downsamples it).
  // DOM-guarded so headless (Node) builds never touch requestAnimationFrame.
  private readonly pumpFrames = (): void => {
    for (const { source, sink } of this.videoEdges.values()) {
      const frame = source.getFrame();
      if (frame) sink(frame);
    }
    if (typeof requestAnimationFrame !== 'undefined') {
      this.rafId = requestAnimationFrame(this.pumpFrames);
    }
  };

  private startFrameLoop(): void {
    if (this.rafId !== null) return;
    if (typeof requestAnimationFrame === 'undefined') return;
    if (this.videoEdges.size === 0) return;
    this.rafId = requestAnimationFrame(this.pumpFrames);
  }

  private stopFrameLoop(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
  }

  async start(): Promise<void> {
    this.running = true;
    if (!this.nested) {
      if (this.ctx instanceof AudioContext) await this.ctx.resume();
      scheduler.start(); // arm every timed control object (metro, delay, …)
    }
    for (const n of this.nodes.values()) n.start?.();
    this.startFrameLoop(); // begin pumping video frames (jit.grab → matrix → window)
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopFrameLoop();
    for (const n of this.nodes.values()) n.stop?.();
    if (this.nested) return;
    scheduler.stop();
    if (this.ctx instanceof AudioContext) await this.ctx.suspend();
  }

  // ── Incremental editing ───────────────────────────────────────────────────
  // Everything below is what a canvas edit costs the audio graph. The rule the whole
  // design rests on is that it should usually cost nothing: `set-rect` — dragging a box
  // — maps to no call at all, and add/remove of one cord touches one cord.
  //
  // ACCEPTED WART: replaceNode() on a playing object CLICKS. Retyping `cycle~ 440` to
  // `cycle~ 441` disposes the oscillator and builds a new one, so the waveform jumps
  // from wherever it was to zero and back. Max does the same thing, and fixing it is not
  // a tweak here: the engine would have to own a GainNode in front of every signal
  // outlet permanently, connect cords to THAT instead of to the object, and on a replace
  // ramp the old gain to 0 and the new one up over ~5 ms while both objects exist. That
  // changes what `signalOuts` means for every factory in src/objects, so it belongs in a
  // pass of its own; the seam is that cords already go through connect(), which is the
  // single place that would learn about the wrapper.

  /** The live node for a box id, or undefined — the engine's half of doc.node(). */
  getNode(id: string): MaxNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * The edgeKey of every cord the engine is actually carrying — its half of
   * doc.edges(). Exists so the invariant the incremental path rests on ("the engine's
   * cords are exactly the document's cords, after any op list") is observable from
   * outside rather than only inferable from whether the patch still makes a sound.
   */
  get liveCords(): string[] {
    return [...this.cords.keys()];
  }

  /**
   * Instantiate one box and put it in the patch.
   *
   * A box built into a patch that is already playing comes up playing, for the reason
   * build() restarts a running patch: a metro added mid-performance with ▶ lit and no
   * ticks is a bug the user has no way to diagnose.
   *
   * Replacing an id the engine already holds tears the old object down first. The
   * document never does that (ids are monotonic and never reused), but an op list
   * replayed against an engine that was not in sync could, and leaking the old object —
   * still connected, still audible, no longer reachable — is the worst available outcome.
   */
  addNode(ir: IRNode): NodeResult {
    if (this.nodes.has(ir.id)) this.removeNode(ir.id);

    const tier = tierOf(ir.className);
    const factory = getFactory(ir.className);
    if (!factory) return { tier };

    let node: MaxNode;
    try {
      node = factory(ir.args, { ctx: this.ctx, node: ir });
    } catch (err) {
      console.error(`Failed to build ${ir.className} (${ir.id}):`, err);
      return { tier };
    }
    this.nodes.set(ir.id, node);
    if (this.running) node.start?.();
    return { tier, node };
  }

  /**
   * Remove one box: cut every cord touching it, then stop and dispose it.
   *
   * The cords go first and they go through disconnect(), so a control subscription is
   * actually unsubscribed rather than left pointing at a disposed object. The document's
   * op stream already emits a remove-edge for each of them before the remove-node (see
   * PatchDoc.removeNodes), so in the normal path this loop finds nothing — it is here
   * for the direct caller and for an op list that arrives out of order.
   */
  removeNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    for (const edge of [...this.cordEdges.values()]) {
      if (edge.from.id === id || edge.to.id === id) this.disconnect(edge);
    }
    node.stop?.();
    node.dispose?.();
    this.nodes.delete(id);
  }

  /**
   * Re-instantiate a box whose text changed.
   *
   * Deliberately does NOT try to preserve the cords. `set-box` never arrives alone: the
   * document brackets it with a remove-edge for every incident cord and an add-edge for
   * every survivor, in one transaction and in replayable order, precisely so that this
   * method can be the dumb one. Re-attaching cords here as well would double-wire every
   * survivor, and guessing which ones survive is the arity question the document has
   * already answered.
   */
  replaceNode(ir: IRNode): NodeResult {
    this.removeNode(ir.id);
    return this.addNode(ir);
  }

  /**
   * Wire one cord. Returns whether anything was actually connected — false for a cord
   * that already exists, names a box the engine does not have, or lands on a port that
   * has no target for its transport (a signal into a control-only inlet). That last case
   * is a legal cord the document keeps and the canvas draws; see ir/connect.ts.
   */
  connect(edge: IREdge): boolean {
    const key = edgeKey(edge);
    if (this.cords.has(key)) return false; // a cord is identified by its ports
    const src = this.nodes.get(edge.from.id);
    const dst = this.nodes.get(edge.to.id);
    if (!src || !dst) return false;

    if (edge.domain === 'signal') {
      const out = src.signalOuts[edge.from.outlet];
      const inn = dst.signalIns[edge.to.inlet];
      if (!out || !inn) return false;
      // .connect accepts AudioNode or AudioParam as destination.
      (out as AudioNode).connect(inn as AudioNode & AudioParam);
      this.record(key, edge, () => (out as AudioNode).disconnect(inn as AudioNode & AudioParam));
      return true;
    }

    if (edge.domain === 'control') {
      const handler = dst.controlIns?.[edge.to.inlet];
      if (!handler || !src.onControlOut) return false;
      const off = src.onControlOut(edge.from.outlet, handler);
      if (typeof off === 'function') {
        this.record(key, edge, off);
      } else {
        // MaxNode.onControlOut is still typed `(() => void) | void` so a node with no
        // control outlets can stay a one-liner, and every factory in src/objects now
        // funnels through runtime/outlets.ts, which returns a real unsubscribe (verified
        // by grep; the only literal implementations, route.ts's send/sendto, return
        // `() => () => {}`). If one ever regresses, the subscription cannot be severed at
        // all: the listener list lives inside the source object and nothing outside it
        // can reach a particular entry. The cord is still recorded so the bookkeeping
        // stays honest, and its teardown says what the repair is — re-instantiating the
        // source box, which is replaceNode() and is the caller's call to make, because
        // it would drop that box's OTHER cords too.
        this.record(key, edge, () => {
          console.warn(
            `Engine: control cord ${key} cannot be cut — ${edge.from.id} returns no ` +
              'unsubscribe from onControlOut; re-instantiate the box to silence it.',
          );
        });
      }
      return true;
    }

    // A jit_matrix cord: a video source outlet feeding a video sink inlet. The rAF pump
    // reads videoEdges every frame, so connecting one while the transport is running has
    // to arm the loop — build() is no longer the only thing that can create the first
    // video cord in a patch.
    const source = src.videoOuts?.[edge.from.outlet];
    const sink = dst.videoIns?.[edge.to.inlet];
    if (!source || !sink) return false;
    this.videoEdges.set(key, { source, sink });
    this.record(key, edge, this.videoTeardown(key));
    if (this.running) this.startFrameLoop();
    return true;
  }

  /** Cut one cord. Returns whether there was one to cut. */
  disconnect(edge: IREdge): boolean {
    const key = edgeKey(edge);
    const teardown = this.cords.get(key);
    if (!teardown) return false;
    this.cords.delete(key);
    this.cordEdges.delete(key);
    teardown();
    // Nothing left to pump: the loop would otherwise reschedule itself forever over an
    // empty map for the rest of the page's life.
    if (this.videoEdges.size === 0) this.stopFrameLoop();
    return true;
  }

  /**
   * Follow one transaction's worth of document edits.
   *
   * Subscribe it to the document and the engine stays in step with no further wiring:
   *
   *     doc.on((ops) => engine.applyOps(ops, doc));
   *
   * The OP LIST is the instruction and is replayed verbatim, in order, exactly as
   * PatchDoc promises (an undo delivers the inverses it actually applied, so there is no
   * second code path for undo). The DOCUMENT is only a reference, consulted for one
   * thing: an op naming a box the engine has never seen. That happens whenever a
   * listener is attached to a document that already has content — the engine would
   * otherwise drop the cord silently and never be told about that box again — so the
   * missing box is built from the document on the spot.
   *
   * `set-rect` is absent from the switch on purpose and is the reason all of this
   * exists: moving a box is the most frequent edit in the editor and it must cost the
   * audio graph nothing at all.
   */
  applyOps(ops: readonly Op[], doc: PatchDoc): void {
    for (const op of ops) {
      switch (op.t) {
        case 'set-rect':
          break; // geometry. The engine does not know where boxes are and must not care.
        case 'add-node':
          this.addNode(op.node);
          break;
        case 'remove-node':
          this.removeNode(op.node.id);
          break;
        case 'set-box':
          this.replaceNode(op.to);
          break;
        case 'add-edge':
          this.ensureNode(op.edge.from.id, doc);
          this.ensureNode(op.edge.to.id, doc);
          this.connect(op.edge);
          break;
        case 'remove-edge':
          this.disconnect(op.edge);
          break;
        case 'renumber':
          this.rekey(op.map, op.edgeMap);
          break;
      }
    }
  }

  /**
   * Re-file every node and every cord under its new id, building nothing.
   *
   * A renumber is a rename and nothing else — reorder() densifies `obj-1..obj-N` at save
   * or codegen time — so not one object is re-instantiated and nothing audible changes.
   * That is the whole test: node identity (===) survives, and a cord filed under the old
   * edgeKey is reachable under the new one.
   *
   * Rebuilt into temporaries and then written back IN PLACE, for two separate reasons.
   * A permutation renamed in place collides with itself halfway through (`obj-3 → obj-2`
   * while `obj-2 → obj-1`); and `BuildReport.built` is this very Map object, handed out
   * to callers who are entitled to keep watching it, so replacing it would quietly leave
   * them reading a snapshot.
   */
  private rekey(map: Record<string, string>, edgeMap: Record<string, string>): void {
    const nodes = [...this.nodes].map(([id, n]) => [map[id] ?? id, n] as const);
    this.nodes.clear();
    for (const [id, n] of nodes) this.nodes.set(id, n);

    const videoEdges = [...this.videoEdges].map(([k, e]) => [edgeMap[k] ?? k, e] as const);
    this.videoEdges.clear();
    for (const [k, e] of videoEdges) this.videoEdges.set(k, e);

    const cords = [...this.cords].map(([k, teardown]) => {
      const next = edgeMap[k] ?? k;
      // The video teardown is the one that closes over its own key (it deletes the entry
      // the pump reads), so a renamed video cord needs a fresh one or disconnect() would
      // delete nothing and the frame would keep being pumped. Signal and control
      // teardowns hold the ports and the subscription, neither of which has a name.
      return [next, this.videoEdges.has(next) ? this.videoTeardown(next) : teardown] as const;
    });
    this.cords.clear();
    for (const [k, teardown] of cords) this.cords.set(k, teardown);

    const cordEdges = [...this.cordEdges].map(([k, e]) => {
      const renamed: IREdge = {
        ...e,
        from: { ...e.from, id: map[e.from.id] ?? e.from.id },
        to: { ...e.to, id: map[e.to.id] ?? e.to.id },
      };
      return [edgeMap[k] ?? edgeKey(renamed), renamed] as const;
    });
    this.cordEdges.clear();
    for (const [k, e] of cordEdges) this.cordEdges.set(k, e);
  }

  /** File a live cord and how to cut it. The only writer of `cords`/`cordEdges`. */
  private record(key: string, edge: IREdge, teardown: () => void): void {
    this.cords.set(key, teardown);
    this.cordEdges.set(key, edge);
  }

  private videoTeardown(key: string): () => void {
    return () => {
      this.videoEdges.delete(key);
    };
  }

  /** Build a box the engine is missing but the document has. See applyOps(). */
  private ensureNode(id: string, doc: PatchDoc): void {
    if (this.nodes.has(id)) return;
    const ir = doc.node(id);
    if (ir) this.addNode(ir);
  }

  /**
   * Tear the patch down — stop and dispose every node and drop every cord — while
   * KEEPING the AudioContext. That distinction is the point: a context survives a
   * rebuild, so the user's audio-unlock gesture and anything already playing survive
   * with it. This is what a patch reload should call.
   *
   * What it deliberately does NOT touch is the process-wide runtime. The scheduler and
   * the named buses are singletons shared by every Engine on the page, and build() calls
   * clear(), so resetting them here would mean building ANY second engine tore down the
   * first one's patch: engine/selftest.ts builds one over an OfflineAudioContext, so
   * pressing ✓ Self-test would stop every metro and deafen every `receive` in the patch
   * that is playing — unrecoverably, since scheduler.start() can only re-arm timers that
   * are still registered. A patch's own share of both is covered per node: a timed
   * object's dispose() cancels its own timer (objects/control/index.ts) and `receive`'s
   * drops its own subscription (objects/control/route.ts). The patch-wide reset belongs
   * to dispose(), which is page teardown and owns the page.
   */
  clear(): void {
    this.stopFrameLoop();
    // EVERY CORD IS CUT FIRST, and it has to be. This used to drop the teardown thunks
    // unrun, on the theory that both ends were about to be disposed anyway — which is
    // only true if every factory HAS a dispose that unwires itself, and the audio domain
    // largely did not: cycle~ left its OscillatorNode running and ezdac~ left its merger
    // wired to ctx.destination. So the old signal chain stayed connected to the speakers
    // for the life of the page: File > New left the previous patch audible with the
    // document reading "0 boxes", and each Open stacked another permanently-audible copy
    // on top until the sum clipped. Cutting the cords is what actually makes a cleared
    // patch silent; the dispose() hooks below then reclaim the nodes.
    //
    // Each thunk is guarded because AudioNode.disconnect() throws when the connection is
    // already gone, which a node's own dispose() (or a context close) is entitled to have
    // done — and one such throw must not strand the remaining cords connected.
    for (const teardown of this.cords.values()) {
      try {
        teardown();
      } catch {
        /* already unwired by the node itself */
      }
    }
    this.cords.clear();
    this.cordEdges.clear();
    for (const n of this.nodes.values()) { n.stop?.(); n.dispose?.(); }
    this.nodes.clear();
    this.videoEdges.clear();
  }

  /**
   * Page teardown: clear(), reset the shared runtime (transport timers, named buses and
   * the `value` store) and close the AudioContext. The engine is unusable afterwards —
   * a closed context can never build another node — so reach for clear() unless the page
   * itself is going away.
   */
  async dispose(): Promise<void> {
    this.clear();
    this.running = false;
    scheduler.clear();
    buses.clear();
    if (this.ctx instanceof AudioContext) await this.ctx.close();
  }
}
