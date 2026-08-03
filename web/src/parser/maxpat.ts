// .maxpat JSON  ->  IRPatch
//
// The .maxpat format nests every object under boxes[].box and every cord under
// lines[].patchline. The two rules that matter:
//   1. For maxclass "newobj", the class name + args live in `text` ("*~ 0.2").
//      For UI objects (number, message, ezdac~, toggle, ...) the maxclass IS the class.
//   2. Each outlet's domain is given by outlettype[] — "signal" is audio,
//      "jit_matrix" is video, everything else ("", "bang", "int", ...) is control.

import type { ArgValue, Domain, IREdge, IRNode, IRPatch } from '../ir/types';

/** Max maxclass values whose class name comes from `text` rather than the maxclass. */
const TEXT_DEFINED_CLASSES = new Set(['newobj']);

function coerceArg(token: string): ArgValue {
  if (token === '') return token;
  const n = Number(token);
  return Number.isNaN(n) ? token : n;
}

/** Split box text into a class name and its args, collapsing extra whitespace. */
function parseText(maxclass: string, text: string): { className: string; args: ArgValue[] } {
  const tokens = (text ?? '').trim().split(/\s+/).filter((t) => t.length > 0);
  if (TEXT_DEFINED_CLASSES.has(maxclass)) {
    const [className = maxclass, ...rest] = tokens;
    return { className, args: rest.map(coerceArg) };
  }
  // UI object: maxclass is the class; any remaining tokens are args/label.
  return { className: maxclass, args: tokens.map(coerceArg) };
}

function outletDomain(outlettype: string | undefined): Domain {
  if (outlettype === 'signal' || outlettype === 'multichannelsignal') return 'signal';
  if (outlettype === 'jit_matrix') return 'video';
  return 'control';
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
    const { className, args } = parseText(maxclass, text);

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
    };
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
    edges.push({ from: { id: fromId, outlet }, to: { id: toId, inlet }, domain });
  }

  return { nodes, edges, byId };
}
