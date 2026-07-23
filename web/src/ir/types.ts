// The intermediate representation: a clean, typed graph parsed from a .maxpat file.
// Both the graph renderer and the audio engine consume this — never the raw JSON.

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
}

export interface IREdge {
  from: { id: string; outlet: number };
  to: { id: string; inlet: number };
  domain: Domain;             // read from the source node's outlet domain
}

export interface IRPatch {
  nodes: IRNode[];
  edges: IREdge[];
  byId: Map<string, IRNode>;
}
