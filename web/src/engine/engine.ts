// The engine: turn an IRPatch into a live Web Audio graph.
//
// For M0-M2 this wires the signal domain (audio cords). Control-domain wiring is
// stubbed via each node's controlIns/onControlOut and will be driven by the
// scheduler in a later milestone — the seams are already here.

import type { IRPatch } from '../ir/types';
import { getFactory, tierOf, type MaxNode } from './registry';
import { scheduler } from '../runtime/scheduler';
import { buses } from '../runtime/buses';

export interface BuildReport {
  built: Map<string, MaxNode>;
  implemented: string[]; // Tier B: real behavior
  stubbed: string[]; // Tier A: recognized (correct I/O) but no behavior yet
  unknown: string[]; // not in the manifest at all (e.g. a subpatcher/abstraction)
}

export class Engine {
  readonly ctx: BaseAudioContext;
  private nodes = new Map<string, MaxNode>();

  // Accepts a live AudioContext (playback) or an OfflineAudioContext (self-test).
  constructor(ctx?: BaseAudioContext) {
    this.ctx = ctx ?? new AudioContext();
    // A live context starts suspended until a user gesture, so nothing plays
    // until Start is pressed. Offline contexts render on demand instead.
    if (this.ctx instanceof AudioContext) void this.ctx.suspend();
  }

  /** Instantiate every object and connect the cords. Returns what got built. */
  build(patch: IRPatch): BuildReport {
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
        this.nodes.set(node.id, factory(node.args, { ctx: this.ctx }));
        (tierOf(node.className) === 'B' ? implemented : stubbed).add(node.className);
      } catch (err) {
        console.error(`Failed to build ${node.className} (${node.id}):`, err);
        unknown.add(node.className);
      }
    }

    for (const edge of patch.edges) {
      const src = this.nodes.get(edge.from.id);
      const dst = this.nodes.get(edge.to.id);
      if (!src || !dst) continue;

      if (edge.domain === 'signal') {
        const out = src.signalOuts[edge.from.outlet];
        const inn = dst.signalIns[edge.to.inlet];
        if (out && inn) {
          // .connect accepts AudioNode or AudioParam as destination.
          (out as AudioNode).connect(inn as AudioNode & AudioParam);
        }
      } else if (edge.domain === 'control') {
        const handler = dst.controlIns?.[edge.to.inlet];
        if (handler && src.onControlOut) {
          src.onControlOut(edge.from.outlet, handler);
        }
      }
      // 'video' cords are ignored for now.
    }

    // Note: node.start/stop are the transport hooks (see start()/stop()), not
    // called here — timed control objects (metro, delay) begin only when the
    // user presses ▶, so they stay in sync with when audio actually plays.

    return {
      built: this.nodes,
      implemented: [...implemented],
      stubbed: [...stubbed],
      unknown: [...unknown],
    };
  }

  async start(): Promise<void> {
    if (this.ctx instanceof AudioContext) await this.ctx.resume();
    scheduler.start(); // arm every timed control object (metro, delay, …)
    for (const n of this.nodes.values()) n.start?.();
  }

  async stop(): Promise<void> {
    for (const n of this.nodes.values()) n.stop?.();
    scheduler.stop();
    if (this.ctx instanceof AudioContext) await this.ctx.suspend();
  }

  /** Tear everything down (called before loading a new patch). */
  async dispose(): Promise<void> {
    for (const n of this.nodes.values()) { n.stop?.(); n.dispose?.(); }
    scheduler.clear();
    buses.clear();
    this.nodes.clear();
    if (this.ctx instanceof AudioContext) await this.ctx.close();
  }
}
