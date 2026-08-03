// The object registry: maps a Max class name -> a factory that builds its runtime
// representation. Two tiers of factory live here:
//   • Tier B (real): hand-written factories registered via register(). Full behavior.
//   • Tier A (stub): auto-generated from the metadata manifest for every remaining
//     object, with correct inlet/outlet counts + domains, no behavior, never throws.
// A patch therefore never contains an "unknown" object — only implemented vs stubbed.

import type { ArgValue } from '../ir/types';
import type { Msg } from '../runtime/atoms';
import manifest from '../generated/manifest.json';

export type { Msg } from '../runtime/atoms';
/** @deprecated legacy scalar name — control values are now Msg (Atom[]). */
export type ControlValue = Msg;

/** Context handed to every factory. Offline (self-test) or live share the same API. */
export interface BuildContext {
  ctx: BaseAudioContext;
}

/**
 * A built runtime object. Signal cords wire signalOuts -> signalIns via the Web
 * Audio graph; control cords wire onControlOut emitters -> controlIns handlers.
 * All arrays are indexed by inlet/outlet number; a missing entry means "no such port".
 */
export interface MaxNode {
  /** Audio target for an incoming signal cord into inlet i (AudioNode or AudioParam). */
  signalIns: (AudioNode | AudioParam | undefined)[];
  /** Audio source to connect from for outlet i. */
  signalOuts: (AudioNode | undefined)[];
  /** Handler invoked when a control message arrives at inlet i (undefined = ignored). */
  controlIns?: (((m: Msg) => void) | undefined)[];
  /** Register a listener for messages leaving outlet i. */
  onControlOut?: (outlet: number, cb: (m: Msg) => void) => void;
  /** Optional DOM widget (sliders, number boxes, meters). */
  el?: HTMLElement;
  /** Transport ▶ hook (e.g. a metro begins ticking). */
  start?: () => void;
  /** Transport ■ hook. */
  stop?: () => void;
  /** Patch reload / teardown: cancel timers, unsubscribe from buses, etc. */
  dispose?: () => void;
}

export type Factory = (args: ArgValue[], build: BuildContext) => MaxNode;

export type Tier = 'B' | 'A' | 'none';

interface ManifestEntry {
  pkg: string;
  maxclass: string;
  numInlets: number;
  numOutlets: number;
  outletDomains: ('signal' | 'control' | 'video')[];
  args: { name: string; type: string[]; optional: boolean }[];
  aliases: string[];
  aliasOf?: string;
}

export const MANIFEST = manifest as Record<string, ManifestEntry>;

const registry = new Map<string, Factory>();
const realImpls = new Set<string>(); // Tier B: hand-written behavior

/** Register a real (Tier B) factory. */
export function register(className: string, factory: Factory): void {
  registry.set(className, factory);
  realImpls.add(className);
}

/** Point one class name at another's factory (e.g. `t` -> `trigger`). */
export function registerAlias(alias: string, canonical: string): void {
  const f = registry.get(canonical);
  if (f) {
    registry.set(alias, f);
    realImpls.add(alias);
  }
}

export function getFactory(className: string): Factory | undefined {
  return registry.get(className);
}

/** Tier B — has real behavior. (Kept name for existing callers/graph rendering.) */
export function isSupported(className: string): boolean {
  return realImpls.has(className);
}

/** Tier A or B — the engine knows its I/O and can build it without crashing. */
export function isRecognized(className: string): boolean {
  return registry.has(className);
}

export function tierOf(className: string): Tier {
  if (realImpls.has(className)) return 'B';
  if (registry.has(className)) return 'A';
  return 'none';
}

/** Coerce an arg to a number with a fallback (args may be strings from box text). */
export function num(arg: ArgValue | undefined, fallback: number): number {
  const n = typeof arg === 'number' ? arg : Number(arg);
  return Number.isFinite(n) ? n : fallback;
}

// ── Tier-A stub generation ────────────────────────────────────────────────────

/**
 * A metadata-driven stub: correct inlet/outlet arity + domains, no behavior, and
 * safe to wire (signal ports are real gain nodes; inlet 0 passes through to the
 * first signal outlet so audio chains degrade instead of going silent). Control
 * inlets are no-ops; control outlets exist but never emit.
 */
function makeStub(entry: ManifestEntry): Factory {
  return (_args, { ctx }) => {
    const signalIns: (AudioNode | AudioParam | undefined)[] = [];
    const controlIns: (((m: Msg) => void) | undefined)[] = [];
    for (let i = 0; i < entry.numInlets; i++) {
      signalIns[i] = ctx.createGain();
      controlIns[i] = () => {};
    }
    const signalOuts: (AudioNode | undefined)[] = [];
    for (let i = 0; i < entry.numOutlets; i++) {
      if (entry.outletDomains[i] === 'signal') signalOuts[i] = ctx.createGain();
    }
    const firstSig = entry.outletDomains.findIndex((d) => d === 'signal');
    const inNode = signalIns[0];
    if (firstSig >= 0 && signalOuts[firstSig] && inNode && 'connect' in inNode) {
      (inNode as AudioNode).connect(signalOuts[firstSig] as AudioNode);
    }
    return { signalIns, signalOuts, controlIns, onControlOut: () => {} };
  };
}

/**
 * Fill the registry with a Tier-A stub for every manifest object that has no real
 * factory yet. Call AFTER importing the real object modules so stubs never shadow
 * implementations. Idempotent.
 */
export function registerStubs(): void {
  for (const [className, entry] of Object.entries(MANIFEST)) {
    if (!registry.has(className)) registry.set(className, makeStub(entry));
  }
}

/** Every class name the manifest knows about (for signature/fuzz tests). */
export function allClassNames(): string[] {
  return Object.keys(MANIFEST);
}
