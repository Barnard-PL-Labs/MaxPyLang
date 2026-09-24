// .maxpat JSON  ->  IRPatch
//
// The .maxpat format nests every object under boxes[].box and every cord under
// lines[].patchline. The two rules that matter:
//   1. For maxclass "newobj", the class name + args live in `text` ("*~ 0.2").
//      For UI objects (number, message, ezdac~, toggle, ...) the maxclass IS the class.
//   2. Each outlet's domain is given by outlettype[] — "signal" is audio,
//      "jit_matrix" is video, everything else ("", "bang", "int", ...) is control.
//
// Both rules are now enforced elsewhere and merely applied here: text is split by
// ir/objectspec (so `cycle~ @frequency 440` is one attribute and NOT two arguments),
// and the outlettype mapping is ir/domain's.
//
// Parsing is also lossy by design — the IR keeps what the engine and the renderer need
// — so every box dict, every patchline dict and the patcher header are stashed verbatim
// on the way past. Nothing downstream reads them; a writer does, and without them saving
// a patch would delete every Max attribute this app has no opinion about — a box's
// bgcolor, a cord's `order` (which fixes fan-out execution order and so changes what the
// patch does), the keys a Max newer than this code invents.

import { outletDomain } from '../ir/domain';
import { parseBoxText } from '../ir/objectspec';
import { reconcileSubpatcherPorts } from '../ir/subpatcher';
import type { ArgValue, Domain, IREdge, IRNode, IRPatch } from '../ir/types';

/** Max maxclass values whose class name comes from `text` rather than the maxclass. */
const TEXT_DEFINED_CLASSES = new Set(['newobj']);

/** Split box text into a class name and its args, collapsing extra whitespace. */
function parseText(
  maxclass: string,
  text: string,
): { className: string; args: ArgValue[]; attrs: Record<string, string[]> } {
  if (TEXT_DEFINED_CLASSES.has(maxclass)) {
    const { name, args, attrs } = parseBoxText(text);
    // An empty newobj box has no name to read; fall back to the maxclass as before.
    return { className: name || maxclass, args, attrs };
  }
  // UI object: the maxclass is the class, so every token in the text is an arg.
  const { args, attrs } = parseBoxText(text, maxclass);
  return { className: maxclass, args, attrs };
}

export function parseMaxPat(json: unknown): IRPatch {
  const patcher = (json as any)?.patcher;
  if (!patcher || !Array.isArray(patcher.boxes)) {
    throw new Error('Not a valid .maxpat file: missing patcher.boxes');
  }

  const nodes: IRNode[] = [];
  const byId = new Map<string, IRNode>();

  for (const entry of patcher.boxes) {
    const box = entry?.box;
    if (!box || typeof box.id !== 'string') continue;

    const maxclass: string = box.maxclass ?? 'newobj';
    const text: string = box.text ?? '';
    const { className, args, attrs } = parseText(maxclass, text);

    const numOutlets: number = box.numoutlets ?? 0;
    const outlettype: string[] = Array.isArray(box.outlettype) ? box.outlettype : [];
    const outletDomains: Domain[] = Array.from({ length: numOutlets }, (_, i) =>
      outletDomain(outlettype[i])
    );

    const node: IRNode = {
      id: box.id,
      className,
      args,
      maxclass,
      numInlets: box.numinlets ?? 0,
      numOutlets,
      outletDomains,
      rect: (box.patching_rect ?? [0, 0, 0, 0]) as [number, number, number, number],
      text,
      outletTypes: outlettype,
      attrs,
      raw: box as Record<string, unknown>,
    };
    // A `p` / `patcher` box's ports are its embedded patch's inlet/outlet objects; the
    // saved counts are a cache of that and are kept unless they are too few. See
    // ir/subpatcher.ts for why that direction and not the other.
    reconcileSubpatcherPorts(node);
    nodes.push(node);
    byId.set(node.id, node);
  }

  const edges: IREdge[] = [];
  const lines = Array.isArray(patcher.lines) ? patcher.lines : [];
  for (const entry of lines) {
    const line = entry?.patchline;
    if (!line || !Array.isArray(line.source) || !Array.isArray(line.destination)) continue;
    const [fromId, outlet] = line.source as [string, number];
    const [toId, inlet] = line.destination as [string, number];
    const src = byId.get(fromId);
    const domain: Domain = src?.outletDomains[outlet] ?? 'control';
    const edge: IREdge = {
      from: { id: fromId, outlet },
      to: { id: toId, inlet },
      domain,
      raw: line as Record<string, unknown>,
    };
    if (Array.isArray(line.midpoints)) edge.midpoints = line.midpoints as (number | null)[];
    edges.push(edge);
  }

  // Everything about the patch that isn't its graph: rect, canvas settings, fonts,
  // appversion, subpatcher flags. Carried whole so a save can put it back unchanged.
  const header: Record<string, unknown> = { ...patcher };
  delete header.boxes;
  delete header.lines;

  return { nodes, edges, byId, header };
}
