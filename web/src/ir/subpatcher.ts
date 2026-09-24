// A subpatcher box's ports, read off the patch embedded in it.
//
// A `p` / `patcher` box has no arity of its own: Max numbers its inlets and outlets from
// the `inlet` and `outlet` objects inside it, left to right, and renumbers them when one
// of those moves. The box dict still saves `numinlets` / `numoutlets` / `outlettype`,
// but only as a cache of that rule — which is why the generated manifest can say
// nothing better than maxpylang's stock 0/0 for `patcher`, and why a box typed fresh on
// the canvas (with an empty embedded patcher) has no ports until something is put in it.
//
// Pure data work over the raw box dicts, deliberately independent of the parser and the
// engine: the parser uses it on load, the document uses it when a subpatcher box is
// retyped, and objects/control/subpatch.ts applies the same left-to-right rule when it
// builds the inner patch.

import { outletDomain } from './domain';
import type { IRNode } from './types';

/** What the embedded patch says the box's ports are. */
export interface SubpatcherPorts {
  numInlets: number;
  numOutlets: number;
  /** One Max outlettype token per outlet: "signal" if audio reaches it, else "". */
  outletTypes: string[];
}

interface RawBox {
  id?: unknown;
  maxclass?: unknown;
  text?: unknown;
  patching_rect?: unknown;
  index?: unknown;
  outlettype?: unknown;
}

/** The class a raw box dict is: its first text token for an object box, else its maxclass. */
function classOf(box: RawBox): string {
  const maxclass = typeof box.maxclass === 'string' ? box.maxclass : 'newobj';
  if (maxclass !== 'newobj') return maxclass;
  return (typeof box.text === 'string' ? box.text : '').trim().split(/\s+/)[0] ?? '';
}

/** Left to right, as Max numbers a box's ports; the saved `index` breaks a tie. */
function byPosition(a: RawBox, b: RawBox): number {
  const ax = Array.isArray(a.patching_rect) ? Number(a.patching_rect[0]) : 0;
  const bx = Array.isArray(b.patching_rect) ? Number(b.patching_rect[0]) : 0;
  return ax - bx || Number(a.index ?? 0) - Number(b.index ?? 0);
}

const isSignalType = (t: unknown): boolean => t === 'signal' || t === 'multichannelsignal';

/**
 * The ports an embedded patcher dict gives its box, or undefined when `patcher` is not
 * one (no `boxes` array) — a caller should then keep whatever it already had.
 *
 * An outlet is typed "signal" when any cord into its `outlet` object comes from a signal
 * outlet, which is what Max itself writes into the box's outlettype. Inlets need no
 * type: an inlet's domain is judged from the built node (ir/connect.ts), and the
 * subpatch factory gives every inlet a signal relay.
 */
export function subpatcherPorts(patcher: unknown): SubpatcherPorts | undefined {
  const p = patcher as { boxes?: unknown; lines?: unknown } | undefined;
  if (!p || !Array.isArray(p.boxes)) return undefined;

  const boxes: RawBox[] = p.boxes
    .map((entry: { box?: RawBox } | undefined) => entry?.box)
    .filter((b): b is RawBox => !!b && typeof b === 'object');
  const inlets = boxes.filter((b) => classOf(b) === 'inlet');
  const outlets = boxes.filter((b) => classOf(b) === 'outlet').sort(byPosition);

  const byId = new Map(boxes.map((b) => [b.id, b]));
  const signalInto = new Set<unknown>();
  for (const entry of Array.isArray(p.lines) ? p.lines : []) {
    const line = (entry as { patchline?: { source?: unknown; destination?: unknown } })?.patchline;
    if (!Array.isArray(line?.source) || !Array.isArray(line?.destination)) continue;
    const [fromId, outlet] = line.source as [unknown, number];
    const types = byId.get(fromId)?.outlettype;
    if (Array.isArray(types) && isSignalType(types[outlet])) signalInto.add(line.destination[0]);
  }

  return {
    numInlets: inlets.length,
    numOutlets: outlets.length,
    outletTypes: outlets.map((b) => (signalInto.has(b.id) ? 'signal' : '')),
  };
}

/** Is this class name a subpatcher box? (`p` is Max's abbreviation for `patcher`.) */
export function isSubpatcherClass(className: string): boolean {
  return className === 'p' || className === 'patcher';
}

/**
 * Give a subpatcher node at least the ports its embedded patch has. Mutates `node`.
 *
 * The saved counts win whenever they are at least what the contents imply, and the
 * contents win only where the saved counts are too FEW. Why that asymmetry:
 *
 *   • Max always writes the two in agreement, so a disagreement means a file some other
 *     tool wrote — maxpylang's stock `patcher` box (0/0) with boxes added to it, say.
 *   • Saved counts that are too few are clearly wrong: the ports exist, Max would draw
 *     them, and no cord in the file can reference them, so adding them loses nothing.
 *   • Saved counts that are too MANY are more likely our reader's blind spot than the
 *     file's error (an inner object we don't classify as an inlet/outlet), and the file's
 *     cords are numbered against them. Shrinking to the contents would drop those cords
 *     on load, silently; keeping the saved count keeps them, and a port with nothing
 *     behind it is merely inert at runtime.
 *
 * Extra outlets get their type from the contents; outlets the file already typed keep
 * the saved type.
 */
export function reconcileSubpatcherPorts(node: IRNode): void {
  if (node.maxclass !== 'newobj' || !isSubpatcherClass(node.className)) return;
  const ports = subpatcherPorts(node.raw?.patcher);
  if (!ports) return;
  node.numInlets = Math.max(node.numInlets, ports.numInlets);
  if (ports.numOutlets > node.numOutlets) {
    const types = [...(node.outletTypes ?? [])].slice(0, node.numOutlets);
    while (types.length < node.numOutlets) types.push('');
    for (let i = node.numOutlets; i < ports.numOutlets; i++) types.push(ports.outletTypes[i]);
    node.numOutlets = ports.numOutlets;
    node.outletTypes = types;
    node.outletDomains = types.map((t) => outletDomain(t));
  }
}
