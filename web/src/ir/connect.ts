// Can this cord be drawn? — the one judgement the canvas makes before it commits a drag
// from an outlet to an inlet.
//
// The temptation is to make this a type checker: know every object's signature, refuse
// anything that does not line up, and congratulate yourself on catching mistakes early.
// Max does not work that way and is right not to. People wire a `number` into `cycle~`'s
// "signal" inlet constantly, wire a float into an inlet the reference calls `int`, and
// half the interesting patches in this repo's corpus connect something the documentation
// never contemplated. An editor that refuses a gesture is an editor you fight, and a
// wrong refusal costs far more than a cord that carries nothing: the refusal feels
// broken and unrecoverable, while the dead cord is visible the moment you press ▶.
//
// Hence three verdicts, and a deliberately lopsided distribution between them:
//
//   REFUSE — only for cords that cannot mean anything. The port is not there, the cord
//            is already there, the box would be talking to itself, or the two ends are
//            on different transports (a `jit_matrix` cord is pumped on a rAF loop by
//            engine.ts, not through the Web Audio graph or the control fan-out; there is
//            no code path that could carry it to a non-video inlet, ever).
//   WARN   — the cord is legal, gets drawn (dashed) and logged, but the engine will not
//            carry anything across it: a signal into an inlet with no audio target, or a
//            message into an inlet with no handler.
//   OK     — everything else, which is most things.
//
// WHAT COUNTS AS THE INLET'S DOMAIN. Max records outlet types in the file, so an
// outlet's domain is a fact the IR already has. Inlets are nowhere in the file, so this
// module reconstructs them from two sources of different quality:
//
//   1. the BUILT MaxNode, when the engine has one. This is the strongest evidence
//      available because it is not a description of the object, it IS the object: if
//      `signalIns[i]` is undefined then no audio can reach that inlet no matter what any
//      document says, and if `controlIns[i]` is undefined then no message can.
//   2. generated/objdocs.json's `inletDomains`, lazily imported (~382 KB — the player
//      must never pay for it). It covers 996 objects and can be SHORTER than the real
//      inlet count for an object whose reference page documents only its left inlet, so
//      a missing index inside a known entry defaults to 'control'. A class with no entry
//      at all yields no evidence rather than a guess.
//
// ONE ASYMMETRY, and it is deliberate. A signal outlet into a documented control inlet
// warns on either source; a control outlet into a documented SIGNAL inlet warns only
// when a built node confirms the inlet has no message handler. The prose is not reliable
// in that direction: `cycle~`'s frequency inlet is documented `signal/float` and
// `ezdac~`'s left inlet is documented plain `signal` while being the inlet you send 1
// and 0 to. Warning off the prose alone would light up `number → cycle~`, which is the
// most common patch there is.

import { edgeKey } from '../engine/engine';
import { MANIFEST, type MaxNode } from '../engine/registry';
import type { PatchDoc } from '../doc/patch-doc';
import type { Domain, IREdge } from './types';

/**
 * ok, ok-with-a-complaint, or no.
 *
 * `warn` and `reason` are user-facing one-liners: the canvas shows one in the status
 * line and logs it, so they name the box and the port rather than describing a rule.
 */
export type Verdict = { ok: true } | { ok: true; warn: string } | { ok: false; reason: string };

/** One documented port: its accepted types and what it is for, both as Max prose. */
export interface ObjDocPort {
  index: number;
  type?: string;
  text?: string;
}

export interface ObjDocEntry {
  digest?: string;
  inletDomains?: Domain[];
  inlets?: ObjDocPort[];
  outlets?: ObjDocPort[];
}
export type ObjDocTable = Record<string, ObjDocEntry>;

let docs: ObjDocTable | undefined;
let inflight: Promise<ObjDocTable> | undefined;

/**
 * Pull in generated/objdocs.json.
 *
 * Lazy and never imported at module scope, for the same reason completions.ts defers it:
 * this module sits on the patcher's critical path and the file is ~382 KB of prose the
 * player has no use for. Idempotent; a failed load stays retryable.
 *
 * canConnect() works without it and simply judges less: video cords into an object whose
 * inlets are undocumented are permitted rather than refused, which is the safe direction
 * to be wrong in. Call this once at patcher start-up so the judgement is complete by the
 * time the user draws their first cord.
 */
export function loadObjDocs(): Promise<ObjDocTable> {
  if (docs) return Promise.resolve(docs);
  inflight ??= import('../generated/objdocs.json')
    .then((m) => (docs = m.default as unknown as ObjDocTable))
    .catch((err) => {
      inflight = undefined;
      throw err;
    });
  return inflight;
}

/** The loaded doc table, or undefined before loadObjDocs() has resolved. */
export function objDocs(): ObjDocTable | undefined {
  return docs;
}

/**
 * The documentation for a class, following an alias to its canonical name.
 *
 * Aliases (`t`, `s`, `sig~`) carry no prose of their own, and a `t b f` box whose ports
 * explained nothing would be exactly the box a newcomer most needs explained.
 */
export function objDocFor(className: string): ObjDocEntry | undefined {
  return docs?.[MANIFEST[className]?.aliasOf ?? className];
}

function documentedInlets(className: string): Domain[] | undefined {
  return objDocFor(className)?.inletDomains;
}

/**
 * What this inlet can receive, or undefined when nothing on hand can say.
 *
 * Video is settled before audio on purpose, and it is the one place metadata outranks
 * the built node. Only 7 of the 121 objects with a documented video inlet have a real
 * factory; the other 114 are Tier-A stubs, and a stub fabricates a GainNode for every
 * inlet it has (registry.ts:makeStub). So `signalIns[i] !== undefined` on a stub means
 * "this object is stubbed", not "this inlet takes audio" — reading it as the latter
 * would refuse every jit cord in the catalog except the handful with real behavior.
 */
function inletEvidence(className: string, inlet: number, built?: MaxNode): Domain | undefined {
  if (built?.videoIns?.[inlet]) return 'video';
  const documented = documentedInlets(className);
  if (documented?.[inlet] === 'video') return 'video';
  if (built && built.signalIns[inlet] !== undefined) return 'signal';
  // A known entry with a short array documents only the left inlets; the rest are
  // message inlets in every case in the corpus.
  if (documented) return documented[inlet] ?? 'control';
  return undefined;
}

/**
 * The transport an inlet carries — the inlet-side counterpart to ir/domain's
 * `outletDomain`, for port colouring and tooltips. Unknown resolves to 'control',
 * matching the IR's rule that anything not audio and not a matrix is a message.
 */
export function inletDomain(className: string, inlet: number, built?: MaxNode): Domain {
  return inletEvidence(className, inlet, built) ?? 'control';
}

/** Does a built node have any way at all to receive `domain` at this inlet? */
function accepts(node: MaxNode, inlet: number, domain: Domain): boolean {
  if (domain === 'signal') return node.signalIns[inlet] !== undefined;
  if (domain === 'video') return node.videoIns?.[inlet] !== undefined;
  return node.controlIns?.[inlet] !== undefined;
}

/**
 * Judge a cord before it is made.
 *
 * `built` is the engine's live node map (`BuildReport.built`, or nothing when the patch
 * has never been built). It only ever sharpens the answer — every verdict this function
 * can reach without it, it reaches the same way with it.
 *
 * KNOWN SHARP EDGE in the video refusal, recorded rather than papered over: the inlets
 * documented 'video' also accept ordinary messages in real Max (`bang` into `jit.matrix`
 * to re-output its contents, `fullscreen 1` into `jit.window`), and this refuses those.
 * The refusal is what the engine can honour — a control cord there is wired by
 * engine.ts, so the relaxation is real work, not a flag: `accepts()` above already knows
 * how to ask "does this inlet have a message handler too?", and the seam is to demand
 * that as well before refusing. Left out of this pass because it is only correct for
 * built Tier-B objects, and 114 of the 121 video objects are stubs whose `controlIns`
 * says nothing.
 */
export function canConnect(
  doc: PatchDoc,
  from: IREdge['from'],
  to: IREdge['to'],
  built?: Map<string, MaxNode>,
): Verdict {
  const src = doc.node(from.id);
  if (!src) return { ok: false, reason: `no box ${from.id}` };
  const dst = doc.node(to.id);
  if (!dst) return { ok: false, reason: `no box ${to.id}` };

  // A box feeding itself is a same-instant loop in every one of the three transports:
  // the control fan-out recurses without a depth limit, and a signal cord into the node
  // it came from is a zero-delay feedback path the Web Audio graph rejects outright.
  // Max has a stack-overflow guard; this engine has none, so the cord is refused rather
  // than offered as a way to hang the tab.
  if (from.id === to.id) return { ok: false, reason: `${src.className} cannot connect to itself` };

  if (!Number.isInteger(from.outlet) || from.outlet < 0 || from.outlet >= src.numOutlets) {
    return { ok: false, reason: `${src.className} has no outlet ${from.outlet}` };
  }
  if (!Number.isInteger(to.inlet) || to.inlet < 0 || to.inlet >= dst.numInlets) {
    return { ok: false, reason: `${dst.className} has no inlet ${to.inlet}` };
  }

  const outDomain = src.outletDomains[from.outlet] ?? 'control';
  // Keyed exactly as the document and the engine key it — the cord this drag would make
  // IS this edge, so no second notion of cord identity is introduced here.
  if (doc.edge(edgeKey({ from, to, domain: outDomain }))) {
    return { ok: false, reason: 'already connected' };
  }

  const dstNode = built?.get(to.id);
  const inDomain = inletEvidence(dst.className, to.inlet, dstNode);

  if (outDomain === 'video' && inDomain !== undefined && inDomain !== 'video') {
    return {
      ok: false,
      reason: `a jit_matrix cord cannot feed ${dst.className}'s ${inDomain} inlet ${to.inlet}`,
    };
  }
  if (inDomain === 'video' && outDomain !== 'video') {
    return {
      ok: false,
      reason: `${src.className} outlet ${from.outlet} carries ${outDomain}, not a jit_matrix`,
    };
  }

  if (outDomain === 'signal') {
    const dead = dstNode ? !accepts(dstNode, to.inlet, 'signal') : inDomain === 'control';
    if (dead) {
      return { ok: true, warn: `${dst.className} inlet ${to.inlet} takes messages, not audio` };
    }
  }
  // The other direction is judged ONLY against a built node; see the asymmetry note in
  // the module header for why the documentation cannot be trusted here.
  if (outDomain === 'control' && dstNode && !accepts(dstNode, to.inlet, 'control')) {
    return { ok: true, warn: `${dst.className} inlet ${to.inlet} takes audio, not messages` };
  }

  return { ok: true };
}
