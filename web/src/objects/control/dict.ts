// Control-domain DICT objects (BATCH "dict"): a named in-memory key→value store
// and the message⇄dict helpers around it.
//
// Same contract as control/index.ts (the reference pattern):
//   const o = makeOutlets();
//   return { signalIns: [], signalOuts: [], controlIns: [ (m) => { … o.emit(0, msg) } ],
//            onControlOut: o.onControlOut, dispose?() };
//
// This module is self-registering (importing it runs the register(...) calls) and
// touches only NEW code — no shared file is edited.
//
// ── Modelling ─────────────────────────────────────────────────────────────────
// A dictionary is a Map<string, Msg>: a key (symbol) → a value message (Atom[], so a
// value can be a scalar `[5]` or a list `[1,2,3]`). Dictionaries live in a
// module-local store keyed by name, exactly like Max passes dicts by reference: an
// object does not carry the dict inline, it emits a REFERENCE message
// `['dictionary', <name>]`. Downstream dict objects resolve that name back to the
// live Map. This in-memory reference is what makes pack→unpack / serialize round
// trips work WITHOUT a JSON string bridge (dict.serialize/deserialize add the real
// JSON bridge on top, which JS's JSON.stringify/parse make trivial and complete).

import { register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { BANG, isBang, type Atom, type Msg } from '../../runtime/atoms';

type DictData = Map<string, Msg>;

/** The shared, module-local named-dictionary store. */
const store = new Map<string, DictData>();
let anon = 0; // counter for auto-generated (anonymous / private) dict names

function ensure(name: string): DictData {
  let d = store.get(name);
  if (!d) { d = new Map(); store.set(name, d); }
  return d;
}

const DICT = 'dictionary';
/** Build a reference message pointing at a named dict. */
const ref = (name: string): Msg => [DICT, name];
/** If `m` is a `['dictionary', name]` reference, return the name. */
function refName(m: Msg): string | undefined {
  return m[0] === DICT && typeof m[1] === 'string' ? m[1] : undefined;
}
/** Resolve a reference message to its live dict (undefined if not a ref / unknown). */
function resolve(m: Msg): DictData | undefined {
  const n = refName(m);
  return n === undefined ? undefined : store.get(n);
}

// ── dict [name] [filename] : the named store (2 inlets, 4 outlets) ────────────
//
// Inlet 0 accepts the standard message selectors below; inlet 1 exists for arity.
//   set/replace <key> <value…>   store (silent)
//   append <key> <value…>        append to a key's value list (silent)
//   get <key>                    → outlet 0: the stored value ([] if missing)
//   delete/remove <key>          remove a key (silent)
//   clear                        empty the dict (silent)
//   getkeys                      → outlet 0: the list of keys
//   getsize                      → outlet 0: [entry count]
//   dump                         → outlet 0: one `key value…` per entry, then outlet 3: bang
//   bang                         → outlet 1: the `dictionary <name>` reference (pass it on)
// Outlets: 0 = data, 1 = dict reference, 2 = (arity only), 3 = dumpout bang.
// `filename` (arg 1) is accepted but ignored — there is no file I/O in the browser.
register('dict', (args) => {
  const o = makeOutlets();
  const name = args[0] !== undefined ? String(args[0]) : `_dict_${anon++}`;
  ensure(name);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const d = ensure(name);
        if (isBang(m)) { o.emit(1, ref(name)); return; }
        const sel = typeof m[0] === 'string' ? m[0] : undefined;
        if (sel === undefined) return;
        switch (sel) {
          case 'set':
          case 'replace': {
            if (m[1] !== undefined) d.set(String(m[1]), m.slice(2));
            break;
          }
          case 'append': {
            if (m[1] !== undefined) {
              const k = String(m[1]);
              d.set(k, [...(d.get(k) ?? []), ...m.slice(2)]);
            }
            break;
          }
          case 'get':
            if (m[1] !== undefined) o.emit(0, d.get(String(m[1])) ?? []);
            break;
          case 'delete':
          case 'remove':
            if (m[1] !== undefined) d.delete(String(m[1]));
            break;
          case 'clear':
            d.clear();
            break;
          case 'getkeys':
            o.emit(0, [...d.keys()]);
            break;
          case 'getsize':
            o.emit(0, [d.size]);
            break;
          case 'dump':
            for (const [k, v] of d) o.emit(0, [k, ...v]);
            o.emit(3, BANG);
            break;
        }
      },
      () => {}, // inlet 1 (arity only)
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── dict.pack [keys…] : assemble a dict from `key value` messages (1 in, 1 out) ─
//
// Creation args predeclare keys (default value 0). A `<key> <value…>` message sets a
// key; a bang outputs the assembled `dictionary <name>` reference. Each instance owns
// one private dict, reused across bangs (an accumulator, as in Max).
register('dict.pack', (args) => {
  const o = makeOutlets();
  const name = `_pack_${anon++}`;
  const d = ensure(name);
  for (const a of args) d.set(String(a), [0]);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { o.emit(0, ref(name)); return; }
        const key = m[0];
        if (typeof key === 'string' && key !== 'bang') d.set(key, m.slice(1));
      },
    ],
    onControlOut: o.onControlOut,
    dispose: () => store.delete(name),
  } satisfies MaxNode;
});

// ── dict.unpack [keys…] : a dict reference → `key value…` messages (1 in, 1 out) ─
//
// On a `dictionary <name>` reference, emit one `key value…` message per key on outlet
// 0. Creation args restrict/order the keys emitted; with no args, every entry is
// emitted (in insertion order). The clean inverse of dict.pack.
register('dict.unpack', (args) => {
  const o = makeOutlets();
  const keys = args.map(String);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const d = resolve(m);
        if (!d) return;
        const iterKeys = keys.length ? keys : [...d.keys()];
        for (const k of iterKeys) if (d.has(k)) o.emit(0, [k, ...(d.get(k) ?? [])]);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── dict.iter : iterate a dict, emitting each entry (1 in, 1 out) ──────────────
//
// A `dictionary <name>` reference is iterated immediately (one `key value…` per entry
// on outlet 0) and remembered, so a subsequent bang re-iterates the last dict.
register('dict.iter', () => {
  const o = makeOutlets();
  let last: string | undefined;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        let d: DictData | undefined;
        if (isBang(m)) d = last !== undefined ? store.get(last) : undefined;
        else {
          const n = refName(m);
          if (n !== undefined) { last = n; d = store.get(n); }
        }
        if (!d) return;
        for (const [k, v] of d) o.emit(0, [k, ...v]);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── dict.join : merge two dicts (2 in, 1 out) ─────────────────────────────────
//
// Inlet 1 stores the "overlay" dict reference; a reference (or bang) at inlet 0
// triggers a merge — inlet-0 dict as the base, inlet-1 keys overlaid on top — and
// emits the merged `dictionary <name>` reference on outlet 0. One private result dict
// per instance, refilled each merge.
register('dict.join', () => {
  const o = makeOutlets();
  const name = `_join_${anon++}`;
  let baseRef: Msg | undefined;
  let joinRef: Msg | undefined;
  const fire = () => {
    const out = ensure(name);
    out.clear();
    for (const src of [baseRef, joinRef]) {
      const d = src && resolve(src);
      if (d) for (const [k, v] of d) out.set(k, v);
    }
    o.emit(0, ref(name));
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { fire(); return; }
        if (refName(m) !== undefined) { baseRef = m; fire(); }
      },
      (m) => { if (refName(m) !== undefined) joinRef = m; },
    ],
    onControlOut: o.onControlOut,
    dispose: () => store.delete(name),
  } satisfies MaxNode;
});

// ── dict.strip [keys…] : remove keys from a dict (1 in, 2 out) ─────────────────
//
// On a `dictionary <name>` reference, emit a `dictionary <name2>` reference with the
// named keys removed on outlet 0, then a dumpout bang on outlet 1. With no key args,
// nothing is stripped (a straight copy). Private result dict reused per instance.
register('dict.strip', (args) => {
  const o = makeOutlets();
  const name = `_strip_${anon++}`;
  const strip = new Set(args.map(String));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const d = resolve(m);
        if (!d) return;
        const out = ensure(name);
        out.clear();
        for (const [k, v] of d) if (!strip.has(k)) out.set(k, v);
        o.emit(0, ref(name));
        o.emit(1, BANG);
      },
    ],
    onControlOut: o.onControlOut,
    dispose: () => store.delete(name),
  } satisfies MaxNode;
});

// ── dict.route [keys…] : split a dict by key membership (2 in, 2 out) ──────────
//
// On a `dictionary <name>` reference, entries whose key is in the routing set go to a
// "matched" dict (outlet 0); the remaining entries go to a "rest" dict (outlet 1).
// Both are emitted as references. Inlet 1 replaces the routing keys from a message's
// symbol atoms. Two private result dicts per instance, refilled each route.
register('dict.route', (args) => {
  const o = makeOutlets();
  const matchedName = `_routeM_${anon++}`;
  const restName = `_routeR_${anon++}`;
  let keys = new Set(args.map(String));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const d = resolve(m);
        if (!d) return;
        const matched = ensure(matchedName);
        matched.clear();
        const rest = ensure(restName);
        rest.clear();
        for (const [k, v] of d) (keys.has(k) ? matched : rest).set(k, v);
        o.emit(0, ref(matchedName));
        o.emit(1, ref(restName));
      },
      (m) => {
        const ks = m.filter((a) => typeof a === 'string' && a !== 'bang').map(String);
        if (ks.length) keys = new Set(ks);
      },
    ],
    onControlOut: o.onControlOut,
    dispose: () => { store.delete(matchedName); store.delete(restName); },
  } satisfies MaxNode;
});

// ── JSON bridge: dict.serialize / dict.deserialize ────────────────────────────

/** dict → plain object: a 1-atom value collapses to a scalar, otherwise an array. */
function dictToObj(d: DictData): Record<string, Atom | Atom[]> {
  const obj: Record<string, Atom | Atom[]> = {};
  for (const [k, v] of d) obj[k] = v.length === 1 ? v[0] : [...v];
  return obj;
}
/** plain JSON value → value message (inverse of the collapse above). */
function valToMsg(val: unknown): Msg {
  if (Array.isArray(val)) return val.filter((x): x is Atom => typeof x === 'number' || typeof x === 'string');
  if (typeof val === 'number' || typeof val === 'string') return [val];
  if (typeof val === 'boolean') return [val ? 1 : 0];
  return [];
}

// dict.serialize : a dict reference → its JSON text as a single symbol atom (1 in, 1 out).
register('dict.serialize', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const d = resolve(m);
        if (d) o.emit(0, [JSON.stringify(dictToObj(d))]);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// dict.deserialize [name] : a JSON-text symbol atom → a `dictionary <name>` reference
// (1 in, 1 out). Invalid JSON or a non-object is ignored.
register('dict.deserialize', (args) => {
  const o = makeOutlets();
  const name = args[0] !== undefined ? String(args[0]) : `_deser_${anon++}`;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const raw = typeof m[0] === 'string' ? m[0] : undefined;
        if (raw === undefined) return;
        let obj: unknown;
        try { obj = JSON.parse(raw); } catch { return; }
        if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return;
        const d = ensure(name);
        d.clear();
        for (const [k, val] of Object.entries(obj as Record<string, unknown>)) d.set(k, valToMsg(val));
        o.emit(0, ref(name));
      },
    ],
    onControlOut: o.onControlOut,
    dispose: () => { if (name.startsWith('_deser_')) store.delete(name); },
  } satisfies MaxNode;
});

// SKIPPED (recorded in the batch report): dict.slice and dict.group. Their real Max
// semantics (a positional partition index for slice; multi-dictionary aggregation for
// group) are not specifiable as a faithful golden test without a concrete schema, so
// they remain Tier-A stubs rather than being faked.
