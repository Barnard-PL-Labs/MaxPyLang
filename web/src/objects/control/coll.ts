// Control-domain collection stores (BATCH "coll").
//
// This module is self-registering: importing it runs the top-level register(...)
// calls. It touches NO shared file — it only reads the stable contracts (registry,
// outlets, atoms). See control/index.ts for the reference pattern this mirrors.
//
//   coll  — an in-memory Map from an address (int or symbol) to a stored message
//           (Atom[]). The workhorse of many patches: store / recall / dump / clear /
//           next / prev.
//   table — a fixed-size integer array addressed by index: an int peeks (reads out
//           the left outlet), a two-atom list pokes (writes). `set`/`clear` too.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { BANG, isBang, type Atom, type Msg } from '../../runtime/atoms';

// ── coll (1 inlet, 4 outlets) ─────────────────────────────────────────────────
//
// Outlets (left→right): 0 = data stored at an address; 1 = the address that data
// came from (used by dump / next / prev); 2 = unused here; 3 = bang when a dump
// finishes. Max fires right-to-left, so on a dump each entry emits its address
// (outlet 1) before its data (outlet 0).
//
// A numeric address is truncated to an int (coll addresses are ints or symbols).
// The reserved head symbols below are treated as commands rather than symbol
// addresses; everything else with a leading symbol is a symbol store/recall.
const COLL_COMMANDS = new Set(['store', 'remove', 'delete', 'clear', 'dump', 'goto', 'next', 'prev']);

/** Normalise an address atom to a Map key (ints for numbers, string for symbols). */
function collKey(a: Atom): Atom {
  return typeof a === 'number' ? Math.trunc(a) : a;
}

register('coll', (): MaxNode => {
  const o = makeOutlets();
  const store = new Map<Atom, Msg>();
  let ptr = 0; // insertion-order cursor for next/prev

  const recall = (addr: Atom) => {
    const data = store.get(collKey(addr));
    if (data) o.emit(0, data.slice());
  };
  const dump = () => {
    for (const [k, data] of store) {
      o.emit(1, [k]);
      o.emit(0, data.slice());
    }
    o.emit(3, BANG);
  };
  const step = (dir: 1 | -1) => {
    const keys = [...store.keys()];
    if (keys.length === 0) return;
    ptr = ((ptr % keys.length) + keys.length) % keys.length;
    const k = keys[ptr];
    o.emit(1, [k]);
    o.emit(0, (store.get(k) as Msg).slice());
    ptr = (ptr + dir + keys.length) % keys.length;
  };

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (m.length === 0) return;
        if (isBang(m)) { dump(); return; }
        const head = m[0];

        if (typeof head === 'string') {
          const cmd = head.toLowerCase();
          if (COLL_COMMANDS.has(cmd)) {
            switch (cmd) {
              case 'clear': store.clear(); ptr = 0; return;
              case 'dump': dump(); return;
              case 'store': if (m.length >= 2) store.set(collKey(m[1]), m.slice(2)); return;
              case 'remove':
              case 'delete': if (m.length >= 2) store.delete(collKey(m[1])); return;
              case 'goto': if (m.length >= 2) {
                const keys = [...store.keys()];
                const i = keys.indexOf(collKey(m[1]));
                if (i >= 0) ptr = i;
              } return;
              case 'next': step(1); return;
              case 'prev': step(-1); return;
            }
          }
          // Symbol address: alone = recall, with a tail = store.
          if (m.length === 1) recall(head);
          else store.set(collKey(head), m.slice(1));
          return;
        }

        // Numeric address: alone = recall, with a tail = store.
        if (m.length === 1) recall(head);
        else store.set(collKey(head), m.slice(1));
      },
    ],
    onControlOut: o.onControlOut,
  };
});

// ── table (2 inlets, 2 outlets) ───────────────────────────────────────────────
//
// A fixed-size array of ints, addressed by index. Left inlet: an int is an address
// whose stored value is sent out the left outlet (0); a two-atom list "addr value"
// (or `set addr v1 v2 …`) writes; `clear` zeroes the array. Out-of-range addresses
// are ignored (faithful to Max, which does not grow the table from messages).
//
// The right inlet and right outlet exist per the manifest arity; the right-inlet
// write/scan protocol is left unimplemented rather than guessed at.
register('table', (args): MaxNode => {
  const o = makeOutlets();
  // First arg may be a table name (symbol); the size arg is the first numeric one.
  const sizeArg = args.find((a) => Number.isFinite(typeof a === 'number' ? a : Number(a)));
  const size = Math.max(1, Math.trunc(num(sizeArg, 128)));
  const data = new Int32Array(size);

  const write = (idx: number, val: number) => {
    const i = Math.trunc(idx);
    if (i >= 0 && i < size) data[i] = Math.trunc(val);
  };

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (m.length === 0) return;
        const head = m[0];
        if (typeof head === 'string') {
          const cmd = head.toLowerCase();
          if (cmd === 'clear') { data.fill(0); return; }
          if (cmd === 'set' && m.length >= 2) {
            const start = Math.trunc(Number(m[1]));
            for (let k = 2; k < m.length; k++) write(start + (k - 2), Number(m[k]));
            return;
          }
          return;
        }
        if (m.length >= 2) { write(head, Number(m[1])); return; }
        // A lone int is an address: read it out the left outlet.
        const i = Math.trunc(head);
        if (i >= 0 && i < size) o.emit(0, [data[i]]);
      },
    ],
    onControlOut: o.onControlOut,
  };
});
