// The object registry: maps a Max class name -> a factory that builds its
// runtime representation. Adding support for a new object = one register() call.

import type { ArgValue } from '../ir/types';

/** A control-domain value flowing along a non-signal cord (float, int, or a bang). */
export type ControlValue = number | 'bang' | string;

/** Context handed to every factory. Offline (self-test) or live share the same node API. */
export interface BuildContext {
  ctx: BaseAudioContext;
}

/**
 * A built runtime object. Signal cords wire signalOuts -> signalIns via the
 * Web Audio graph; control cords wire controlOut emitters -> controlIn handlers.
 * All arrays are indexed by inlet/outlet number; missing entries mean "no such port".
 */
export interface MaxNode {
  /** Audio target for an incoming signal cord into inlet i (AudioNode or AudioParam). */
  signalIns: (AudioNode | AudioParam | undefined)[];
  /** Audio source to connect from for outlet i. */
  signalOuts: (AudioNode | undefined)[];
  /** Handler invoked when a control value arrives at inlet i (undefined = inlet ignores control). */
  controlIns?: (((v: ControlValue) => void) | undefined)[];
  /** Register a listener for control values leaving outlet i. */
  onControlOut?: (outlet: number, cb: (v: ControlValue) => void) => void;
  /** Optional DOM widget (sliders, number boxes, meters). */
  el?: HTMLElement;
  /** Called once after the whole graph is wired. */
  start?: () => void;
  stop?: () => void;
}

export type Factory = (args: ArgValue[], build: BuildContext) => MaxNode;

const registry = new Map<string, Factory>();

export function register(className: string, factory: Factory): void {
  registry.set(className, factory);
}

export function getFactory(className: string): Factory | undefined {
  return registry.get(className);
}

export function isSupported(className: string): boolean {
  return registry.has(className);
}

/** Coerce an arg to a number with a fallback (args may be strings from box text). */
export function num(arg: ArgValue | undefined, fallback: number): number {
  const n = typeof arg === 'number' ? arg : Number(arg);
  return Number.isFinite(n) ? n : fallback;
}
