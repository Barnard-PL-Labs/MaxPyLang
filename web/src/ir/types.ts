// The intermediate representation: a clean, typed graph parsed from a .maxpat file.
// Both the graph renderer and the audio engine consume this — never the raw JSON.
//
// Everything below the first block of each interface is OPTIONAL and exists so a patch
// can survive a round trip back out to .maxpat. The IR is a distillation: it keeps what
// the engine and the renderer need and drops the rest, and "the rest" is most of what
// Max actually stores about a box (bgcolor, presentation_rect, varname,
// saved_object_attributes, keys from a Max version newer than this code). A writer that
// rebuilt a box from the distilled fields alone would quietly delete all of it, so the
// parser stashes the verbatim originals here and the writer overlays onto them.
// Nothing is required: a node built from scratch on the canvas simply has none of it.

export type Domain = 'signal' | 'control' | 'video';

export type ArgValue = number | string;

export interface IRNode {
  id: string;                 // e.g. "obj-7"
  className: string;          // e.g. "cycle~", "*~", "ezdac~", "number"
  args: ArgValue[];           // parsed from the box text after the class name
  maxclass: string;           // raw Max maxclass ("newobj", "number", "ezdac~", ...)
  numInlets: number;
  numOutlets: number;
  outletDomains: Domain[];    // domain of each outlet, from outlettype[]
  rect: [number, number, number, number]; // [x, y, w, h] in patch coords
  text: string;               // original box text (for display / debugging)

  /** Raw Max `outlettype[]` tokens. outletDomains is the 3-way distillation of this. */
  outletTypes?: string[];
  /** In-box `@key val…` attributes, parsed out of `text` (see ir/objectspec). */
  attrs?: Record<string, string[]>;
  /** False when no object of this name exists — maxpylang's unknown_obj_dict case. */
  known?: boolean;
  /** The box dict exactly as it was read, so a writer can preserve what the IR drops. */
  raw?: Record<string, unknown>;
}

export interface IREdge {
  from: { id: string; outlet: number };
  to: { id: string; inlet: number };
  domain: Domain;             // read from the source node's outlet domain

  /** Max's patchline `midpoints` — cord waypoints, meaningless to the engine. */
  midpoints?: (number | null)[];
  /**
   * The patchline dict exactly as it was read — the cord's counterpart to IRNode.raw,
   * and there for the same reason.
   *
   * A cord is not just a pair of endpoints. Max also writes `order` on it, which fixes
   * the execution order of a fan-out from a single outlet and therefore changes what the
   * patch DOES; 238 of the 6255 patchlines in this repo's hand-built example patches
   * carry one. It writes `hidden` and `disabled` too. None of that is modelled here, so
   * without the original dict a round trip would quietly reorder somebody's fan-out.
   */
  raw?: Record<string, unknown>;
}

export interface IRPatch {
  nodes: IRNode[];
  edges: IREdge[];
  byId: Map<string, IRNode>;

  /** The patcher dict minus `boxes`/`lines`: canvas size, fonts, rect, version, … */
  header?: Record<string, unknown>;
}
