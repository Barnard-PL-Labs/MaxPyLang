// Control-domain DICT objects: Max's named dictionaries and the dict.* family around
// them, modelled on Max's own reference pages (dict*.maxref.xml) and help patchers.
//
// ── Max's model ───────────────────────────────────────────────────────────────
// A dictionary is a named, global key→value store. Objects never pass a dictionary's
// content along a cord: they send the two-atom message `dictionary <name>`, and the
// receiver looks the name up. Two `dict foo` boxes therefore share one dictionary, and
// a dictionary without a name gets a generated one (`u` + digits, as in Max).
//
// Here a dictionary is a Map<string, Msg>: a key → a value message (Atom[]), so a value
// can be one atom `[5]`, a list `[1, 2, 'foo', 3]`, or a nested dictionary, stored —
// exactly as Max stores one set from a cord — as the reference `['dictionary', name]`.
// Keys may name a path into nested dictionaries with Max's `a::b::c` syntax.
//
// Max's "dictionary syntax" (`cow: moo lion : roar 5 times`) is what dict.pack,
// dict.unpack, dict.join and dict.route take as arguments, and what dict.serialize
// writes / dict.deserialize reads: a key is a symbol ending in a colon (or followed by a
// lone `:` atom, or `key:value` in one atom), and the atoms after it are its value.
//
// Not modelled: files (read/write/import/export answer with a failure notification, as
// Max does when a file cannot be opened), coll push/pull, the editor window, array[i]
// indexing, @legacy, and dict.serialize's @compress.

import { register, type MaxNode } from '../../engine/registry';
import type { IRNode } from '../../ir/types';
import { makeOutlets } from '../../runtime/outlets';
import { isBang, type Atom, type Msg } from '../../runtime/atoms';

type DictData = Map<string, Msg>;

/** The shared, module-local named-dictionary store (Max's global dictionary registry). */
const store = new Map<string, DictData>();
/** Sub-dictionaries a dictionary made for itself (`set a::b 1`, setparse, JSON); cloned deeply. */
const owned = new Set<string>();
let anon = 0;

/** A fresh unique name, in Max's style (`u` followed by nine digits). */
function newName(): string {
  let n: string;
  do n = `u${100000000 + ((anon++ * 7919) % 900000000)}`;
  while (store.has(n));
  return n;
}

function ensure(name: string): DictData {
  let d = store.get(name);
  if (!d) { d = new Map(); store.set(name, d); }
  return d;
}

const DICT = 'dictionary';
const ref = (name: string): Msg => [DICT, name];
/** If `m` is a `dictionary <name>` message, return the name. */
function refName(m: Msg): string | undefined {
  return m.length === 2 && m[0] === DICT && typeof m[1] === 'string' ? m[1] : undefined;
}
/** The dictionary a value refers to, if the value is a reference to a known one. */
function subDict(v: Msg | undefined): DictData | undefined {
  const n = v && refName(v);
  return n === undefined ? undefined : store.get(n);
}
/** A sub-dictionary owned by its parent, registered in the store. */
function newOwned(): [string, DictData] {
  const n = newName();
  owned.add(n);
  return [n, ensure(n)];
}

// ── arguments and attributes ──────────────────────────────────────────────────

/** A text token as Max would type it: a number if it reads as one. */
function typed(t: Atom): Atom {
  if (typeof t !== 'string' || t.trim() === '') return t;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

/**
 * A box's positional args and its `@attr value…` attributes. The engine hands
 * factories args with attributes already split off (node.attrs); a factory called
 * directly (tests) may still see `@name` tokens in its args, so both are read.
 */
function argsAndAttrs(args: readonly Atom[], node?: IRNode): { args: Atom[]; attrs: Record<string, Atom[]> } {
  const attrs: Record<string, Atom[]> = {};
  for (const [k, vals] of Object.entries(node?.attrs ?? {})) attrs[k] = vals.map(typed);
  const pos: Atom[] = [];
  let cur: Atom[] | undefined;
  for (const a of args) {
    if (typeof a === 'string' && a.length > 1 && a[0] === '@') attrs[a.slice(1)] = cur = [];
    else (cur ?? pos).push(a);
  }
  return { args: pos, attrs };
}

/** Index of a lone `:` inside a symbol (not part of a `::` path separator), or -1. */
function loneColon(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ':') continue;
    if (s[i + 1] === ':') { i++; continue; }
    return i;
  }
  return -1;
}

type Tok = { key: string } | { val: Atom };

function tokenize(atoms: readonly Atom[]): Tok[] {
  const toks: Tok[] = [];
  for (const a of atoms) {
    if (typeof a !== 'string') { toks.push({ val: a }); continue; }
    if (a === ':') {
      const prev = toks[toks.length - 1];
      if (prev && 'val' in prev) toks[toks.length - 1] = { key: String(prev.val) };
      continue;
    }
    const i = loneColon(a);
    if (i > 0) {
      toks.push({ key: a.slice(0, i) });
      if (i < a.length - 1) toks.push({ val: typed(a.slice(i + 1)) });
      continue;
    }
    toks.push({ val: a });
  }
  return toks;
}

/** Parsed dictionary syntax: atoms before the first key, then ordered key → value. */
interface Syntax { leading: Atom[]; entries: [string, Msg][] }

/**
 * Parse Max dictionary syntax. `{ … }` after a key makes a nested dictionary (created
 * in the store and owned by whichever dictionary the entries land in).
 */
function parseSyntax(atoms: readonly Atom[]): Syntax {
  const toks = tokenize(atoms);
  let i = 0;
  const leading: Atom[] = [];
  while (i < toks.length && 'val' in toks[i]) leading.push((toks[i++] as { val: Atom }).val);
  const parseEntries = (inBraces: boolean): [string, Msg][] => {
    const entries: [string, Msg][] = [];
    while (i < toks.length) {
      const t = toks[i++];
      if ('val' in t) {
        if (inBraces && t.val === '}') return entries;
        continue; // a value with no key: nothing to attach it to
      }
      const value: Atom[] = [];
      while (i < toks.length && 'val' in toks[i]) {
        const v = (toks[i] as { val: Atom }).val;
        if (v === '}' && inBraces) break;
        i++;
        if (v === '{') {
          const [sub, sd] = newOwned();
          for (const [k, vv] of parseEntries(true)) sd.set(k, vv);
          value.push(DICT, sub);
        } else value.push(v);
      }
      entries.push([t.key, value]);
    }
    return entries;
  };
  return { leading, entries: parseEntries(false) };
}

// ── hierarchical keys (`a::b::c`) ─────────────────────────────────────────────

/** The dictionary holding the last segment of `path`, creating levels if asked. */
function locate(d: DictData, path: string, create: boolean): { at: DictData; key: string } | undefined {
  const segs = path.split('::');
  let at = d;
  for (let s = 0; s < segs.length - 1; s++) {
    let next = subDict(at.get(segs[s]));
    if (!next) {
      if (!create) return undefined;
      const [sub, sd] = newOwned();
      at.set(segs[s], ref(sub));
      next = sd;
    }
    at = next;
  }
  return { at, key: segs[segs.length - 1] };
}
function getPath(d: DictData, path: string): Msg | undefined {
  const l = locate(d, path, false);
  return l?.at.get(l.key);
}
function setPath(d: DictData, path: string, v: Msg): void {
  const l = locate(d, path, true)!;
  l.at.set(l.key, v);
}

/** Copy `src` into `dst` (cleared first); sub-dictionaries a dict made itself are copied too. */
function cloneInto(src: DictData, dst: DictData, depth = 0): void {
  if (src === dst) return;
  const entries = [...src];
  dst.clear();
  for (const [k, v] of entries) {
    const n = refName(v);
    if (n !== undefined && owned.has(n) && depth < 32) {
      const [sub, sd] = newOwned();
      cloneInto(store.get(n) ?? new Map(), sd, depth + 1);
      dst.set(k, ref(sub));
    } else dst.set(k, [...v]);
  }
}

function sameMsg(a: Msg, b: Msg): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function typeOf(v: Msg): string {
  if (subDict(v)) return 'dictionary';
  if (v.length !== 1) return 'array';
  const a = v[0];
  if (typeof a === 'string') return 'string';
  return Number.isInteger(a) ? 'int' : 'float';
}

// ── JSON ↔ dictionary ─────────────────────────────────────────────────────────

type Json = Atom | Json[] | { [k: string]: Json };

function toJson(d: DictData, depth = 0): { [k: string]: Json } {
  const obj: { [k: string]: Json } = {};
  for (const [k, v] of d) {
    const sub = subDict(v);
    if (sub && depth < 32) obj[k] = toJson(sub, depth + 1);
    else obj[k] = v.length === 1 ? v[0] : [...v];
  }
  return obj;
}

function fromJsonValue(val: unknown): Msg {
  if (typeof val === 'number' || typeof val === 'string') return [val];
  if (typeof val === 'boolean') return [val ? 1 : 0];
  if (Array.isArray(val)) return val.flatMap(fromJsonValue);
  if (val !== null && typeof val === 'object') {
    const [sub, sd] = newOwned();
    for (const [k, v] of Object.entries(val)) sd.set(k, fromJsonValue(v));
    return ref(sub);
  }
  return [];
}

/**
 * Content given as atoms — a JSON text in one symbol, or dictionary syntax (optionally
 * wrapped in `{ }`) — as entries. Undefined when it parses as neither.
 */
function parseContent(atoms: readonly Atom[]): [string, Msg][] | undefined {
  const text = atoms.length === 1 && typeof atoms[0] === 'string' ? atoms[0].trim() : undefined;
  if (text !== undefined && text.startsWith('{') && text.length > 1) {
    let obj: unknown;
    try { obj = JSON.parse(text); } catch { return undefined; }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    return Object.entries(obj).map(([k, v]) => [k, fromJsonValue(v)]);
  }
  let body = atoms;
  if (body[0] === '{' && body[body.length - 1] === '}') body = body.slice(1, -1);
  const { entries } = parseSyntax(body);
  return entries.length || body.length === 0 ? entries : undefined;
}

/** Dictionary syntax for a dictionary's content, as dict.serialize's default mode sends it. */
function toSyntax(d: DictData, depth = 0): Atom[] {
  const out: Atom[] = [];
  for (const [k, v] of d) {
    out.push(k, ':');
    const sub = subDict(v);
    if (sub && depth < 32) out.push('{', ...toSyntax(sub, depth + 1), '}');
    else out.push(...v);
  }
  return out;
}

const fileOps = new Set(['read', 'readany', 'readagain', 'import', 'write', 'writeagain', 'export']);

// ── dict [name] [filename] : 2 inlets, 5 outlets ──────────────────────────────
//
// Outlets, per the reference: 0 `dictionary <name>` (bang, or a dictionary at the left
// inlet), 1 `<key> <value…>` for get / getsize / gettype, 2 the key list for getkeys and
// 0/1 for contains, 3 every dictionary name for getnames, 4 file notifications.
// A `dictionary <x>` message clones x into this dictionary: at the left inlet it is
// then sent on, at the right inlet it is not.
register('dict', (rawArgs, b) => {
  const o = makeOutlets();
  const { args, attrs } = argsAndAttrs(rawArgs, b?.node);
  const name = String(attrs.name?.[0] ?? args[0] ?? newName());
  ensure(name);

  const cloneFrom = (m: Msg): boolean => {
    const n = refName(m);
    if (n === undefined) return false;
    cloneInto(store.get(n) ?? new Map(), ensure(name));
    return true;
  };

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const d = ensure(name);
        if (isBang(m)) { o.emit(0, ref(name)); return; }
        if (cloneFrom(m)) { o.emit(0, ref(name)); return; }
        const sel = m[0];
        if (typeof sel !== 'string') return;
        const key = m[1] !== undefined ? String(m[1]) : undefined;
        switch (sel) {
          case 'set':
          case 'replace':
            if (key !== undefined) setPath(d, key, m.slice(2));
            break;
          case 'append':
            if (key !== undefined) setPath(d, key, [...(getPath(d, key) ?? []), ...m.slice(2)]);
            break;
          case 'remove':
            if (key !== undefined) { const l = locate(d, key, false); l?.at.delete(l.key); }
            break;
          case 'clear':
            d.clear();
            break;
          case 'get':
            if (key !== undefined) { const v = getPath(d, key); if (v) o.emit(1, [key, ...v]); }
            break;
          case 'getsize':
            if (key !== undefined) { const v = getPath(d, key); if (v) o.emit(1, [key, subDict(v) ? 1 : v.length]); }
            break;
          case 'gettype':
            if (key !== undefined) { const v = getPath(d, key); if (v) o.emit(1, [key, typeOf(v)]); }
            break;
          case 'getkeys': {
            const keys = [...d.keys()];
            if (m[1] !== undefined && m[1] !== 0) keys.sort(); // optional arg: alphabetical
            if (keys.length) o.emit(2, keys);
            break;
          }
          case 'contains':
            if (key !== undefined) o.emit(2, [getPath(d, key) ? 1 : 0]);
            break;
          case 'getnames':
            o.emit(3, [...store.keys()].filter((n) => !owned.has(n)));
            break;
          case 'parse': {
            const entries = parseContent(m.slice(1));
            if (entries) { d.clear(); for (const [k, v] of entries) d.set(k, v); }
            break;
          }
          case 'setparse':
            if (key !== undefined) {
              const entries = parseContent(m.slice(2));
              if (entries) {
                const [sub, sd] = newOwned();
                for (const [k, v] of entries) sd.set(k, v);
                setPath(d, key, ref(sub));
              }
            }
            break;
          default:
            // No file system in the browser: report the failure the way Max does.
            if (fileOps.has(sel)) o.emit(4, [sel, ...m.slice(1, 2), 0]);
        }
      },
      (m) => { cloneFrom(m); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── dict.pack [name] [key: default…] : one inlet per key, plus the unmatched inlet ─
//
// Arguments are dictionary syntax (`dict.pack freq: 440 amp: 0.2`), or @keys; @name
// (or a first argument that is not a key) names the dictionary. Whatever arrives at a
// key's inlet becomes that key's value (a `dictionary x` message stores the reference).
// Like pack, only the left inlet triggers output unless @triggers lists others (-1 =
// every inlet); a bang at any inlet sends. The rightmost inlet takes `key value…` (or a
// dictionary to merge in) for keys without an inlet. Output: `dictionary <name>`.
register('dict.pack', (rawArgs, b) => {
  const o = makeOutlets();
  const { args, attrs } = argsAndAttrs(rawArgs, b?.node);
  const syn = parseSyntax(args);
  const given = attrs.name?.[0] ?? (typeof syn.leading[0] === 'string' ? syn.leading[0] : undefined);
  const name = given !== undefined ? String(given) : newName();
  const keys = attrs.keys ? attrs.keys.map(String) : syn.entries.map(([k]) => k);
  const defaults = new Map(syn.entries);
  const d = ensure(name);
  for (const k of keys) {
    const v = defaults.get(k);
    setPath(d, k, v && v.length ? [...v] : [0]);
  }
  const trig = (attrs.triggers ?? [0]).map(Number);
  const all = trig.includes(-1);
  const send = () => { ensure(name); o.emit(0, ref(name)); };

  const keyInlet = (k: string, i: number) => (m: Msg) => {
    if (isBang(m)) { send(); return; }
    setPath(ensure(name), k, [...m]);
    if (all || trig.includes(i)) send();
  };
  const unmatched = (m: Msg) => {
    if (isBang(m)) { send(); return; }
    const n = refName(m);
    if (n !== undefined) {
      for (const [k, v] of store.get(n) ?? []) ensure(name).set(k, [...v]);
      return;
    }
    if (typeof m[0] === 'string') setPath(ensure(name), m[0], m.slice(1));
  };

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [...keys.map(keyInlet), unmatched],
    onControlOut: o.onControlOut,
    dispose: () => { if (given === undefined) store.delete(name); },
  } satisfies MaxNode;
});

// ── dict.unpack [name] [key:…] : one outlet per key, plus the unmatched outlet ──
//
// On `dictionary <x>`, each listed key that x holds sends its value (just the value,
// no key) from its own outlet; the rightmost outlet sends a dictionary of x's other
// keys. Right to left, as unpack does. A bang re-reads the last dictionary (initially
// the one named by the first argument).
register('dict.unpack', (rawArgs, b) => {
  const o = makeOutlets();
  const { args, attrs } = argsAndAttrs(rawArgs, b?.node);
  const syn = parseSyntax(args);
  const keys = attrs.keys ? attrs.keys.map(String) : syn.entries.map(([k]) => k);
  let last: string | undefined = typeof syn.leading[0] === 'string' ? syn.leading[0] : undefined;
  const restName = newName();

  const fire = () => {
    const d = last !== undefined ? store.get(last) : undefined;
    if (!d) return;
    const rest = ensure(restName);
    rest.clear();
    const top = new Set(keys.map((k) => k.split('::')[0]));
    for (const [k, v] of d) if (!top.has(k)) rest.set(k, [...v]);
    if (rest.size) o.emit(keys.length, ref(restName));
    for (let i = keys.length - 1; i >= 0; i--) {
      const v = getPath(d, keys[i]);
      if (v) o.emit(i, v.length ? v : ['bang']);
    }
  };

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { fire(); return; }
        const n = refName(m);
        if (n !== undefined) { last = n; fire(); }
      },
    ],
    onControlOut: o.onControlOut,
    dispose: () => store.delete(restName),
  } satisfies MaxNode;
});

// ── dict.iter : `dictionary <x>` → one `key value…` list per entry (1 in, 1 out) ─
register('dict.iter', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const n = refName(m);
        const d = n !== undefined ? store.get(n) : undefined;
        if (d) for (const [k, v] of [...d]) o.emit(0, [k, ...v]);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── dict.join [key: value…] : merge two dictionaries (2 in, 1 out) ───────────────
//
// The right inlet's dictionary (initially the one the arguments describe) is joined
// onto each dictionary arriving at the left inlet; on a shared key the right one wins.
// The result is a new dictionary, sent as `dictionary <name>`; bang resends it.
register('dict.join', (rawArgs, b) => {
  const o = makeOutlets();
  const { args } = argsAndAttrs(rawArgs, b?.node);
  const outName = newName();
  const initName = newName();
  const init = ensure(initName);
  for (const [k, v] of parseSyntax(args).entries) init.set(k, v);
  let right = initName;
  let made = false;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { if (made) o.emit(0, ref(outName)); return; }
        const n = refName(m);
        if (n === undefined) return;
        const out = ensure(outName);
        cloneInto(store.get(n) ?? new Map(), out);
        for (const [k, v] of store.get(right) ?? []) out.set(k, [...v]);
        made = true;
        o.emit(0, ref(outName));
      },
      (m) => { const n = refName(m); if (n !== undefined) right = n; },
    ],
    onControlOut: o.onControlOut,
    dispose: () => { store.delete(outName); store.delete(initName); },
  } satisfies MaxNode;
});

// ── dict.strip [keys…] : remove keys from a dictionary (1 in, 2 out) ─────────────
//
// Removes the keys from the incoming dictionary itself (no copy, as in Max), sending
// each removed `key value…` from outlet 1, then the same `dictionary <x>` from outlet 0.
register('dict.strip', (rawArgs, b) => {
  const o = makeOutlets();
  const { args, attrs } = argsAndAttrs(rawArgs, b?.node);
  const keys = (attrs.keys ?? args)
    .map((k) => { const s = String(k); return s.endsWith(':') && !s.endsWith('::') ? s.slice(0, -1) : s; })
    .filter((k) => k !== '');
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const n = refName(m);
        const d = n !== undefined ? store.get(n) : undefined;
        if (!d || n === undefined) return;
        for (const k of keys) {
          const l = locate(d, k, false);
          const v = l?.at.get(l.key);
          if (l && v) { l.at.delete(l.key); o.emit(1, [k, ...v]); }
        }
        o.emit(0, ref(n));
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── dict.route [key: value…] : pass a dictionary left if it matches (2 in, 2 out) ─
//
// The reference dictionary comes from the arguments or the right inlet. A dictionary at
// the left inlet that holds every reference key with an equal value (a reference key
// with no value only has to exist) goes out the left outlet; otherwise the right. The
// incoming `dictionary <x>` message itself is passed on.
function matches(d: DictData, spec: DictData, depth = 0): boolean {
  for (const [k, want] of spec) {
    const have = d.get(k);
    if (!have) return false;
    if (!want.length) continue;
    const hs = subDict(have), ws = subDict(want);
    if (hs && ws && depth < 32) { if (!matches(hs, ws, depth + 1)) return false; continue; }
    if (!sameMsg(have, want)) return false;
  }
  return true;
}
register('dict.route', (rawArgs, b) => {
  const o = makeOutlets();
  const { args } = argsAndAttrs(rawArgs, b?.node);
  const initName = newName();
  const init = ensure(initName);
  for (const [k, v] of parseSyntax(args).entries) init.set(k, v);
  let spec = initName;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const n = refName(m);
        const d = n !== undefined ? store.get(n) : undefined;
        if (!d || n === undefined) return;
        o.emit(matches(d, store.get(spec) ?? new Map()) ? 0 : 1, ref(n));
      },
      (m) => { const n = refName(m); if (n !== undefined) spec = n; },
    ],
    onControlOut: o.onControlOut,
    dispose: () => store.delete(initName),
  } satisfies MaxNode;
});

// ── dict.serialize : a dictionary as text (1 in, 1 out) ─────────────────────────
//
// Default @mode dictionary: the content as dictionary-syntax atoms
// (`freq : 440 pt : 1 2 3`). @mode json: one symbol holding the JSON text.
// @compress (Max's base64 codec) is not implemented and is ignored.
register('dict.serialize', (rawArgs, b) => {
  const o = makeOutlets();
  const { attrs } = argsAndAttrs(rawArgs, b?.node);
  const json = String(attrs.mode?.[0] ?? 'dictionary') === 'json';
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const n = refName(m);
        const d = n !== undefined ? store.get(n) : undefined;
        if (!d) return;
        o.emit(0, json ? [JSON.stringify(toJson(d))] : toSyntax(d));
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── dict.deserialize [name] : text → a dictionary (1 in, 1 out) ─────────────────
//
// Any message: dictionary syntax (`freq: 440 amp: 0.2`, straight from a message box),
// or one symbol of JSON. The content replaces the named (or generated) dictionary,
// which is sent as `dictionary <name>`. Input that is neither is ignored.
register('dict.deserialize', (rawArgs, b) => {
  const o = makeOutlets();
  const { args, attrs } = argsAndAttrs(rawArgs, b?.node);
  const given = attrs.name?.[0] ?? args[0];
  const name = given !== undefined ? String(given) : newName();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) return;
        const entries = parseContent(m);
        if (!entries || !entries.length) return;
        const d = ensure(name);
        d.clear();
        for (const [k, v] of entries) d.set(k, v);
        o.emit(0, ref(name));
      },
    ],
    onControlOut: o.onControlOut,
    dispose: () => { if (given === undefined) store.delete(name); },
  } satisfies MaxNode;
});

// Not implemented here: dict.slice, dict.group, dict.compare, dict.print, dict.view and
// dict.codebox stay Tier-A stubs.
