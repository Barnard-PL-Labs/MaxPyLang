// Control-domain routing / named-bus objects: they move messages between objects by
// name (no cord) via runtime/buses, or synchronise several inlets. Same contract as
// control/index.ts — self-registering via top-level register(...) calls, one
// makeOutlets() per object with outlets, controlIns[i] handlers receiving a Msg, an
// onControlOut fan-out, and a dispose() wherever a bus subscription is allocated.
//
// Batch "route": send (s) receive (r) forward buddy
//   • send/receive are the classic named message pair — send broadcasts on a name,
//     every receive subscribed to that name re-emits it. forward is a send whose
//     destination is settable from its inlet.
//   • buddy collates its inlets, holding each value until every inlet has fired, then
//     releasing them together (a synchroniser).
//
// grab, prepend2 and sprintf2 are intentionally NOT implemented here — see the notes
// at the bottom of this file.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { buses } from '../../runtime/buses';
import { type Atom, type Msg } from '../../runtime/atoms';

// ── send / s ──────────────────────────────────────────────────────────────────

// send <name> (alias `s`) : broadcast any message arriving at the inlet to every
// `receive <name>` in the patch, across cords, by name.
//
// The metadata lists a bare `send` box as 0-in/0-out (an un-parameterised default
// box), but a real `send name` has a message inlet — the batch note directs us to
// bind it to runtime/buses, so inlet 0 is the broadcast inlet here.
function makeSend(args: Atom[]): MaxNode {
  const name = args[0] === undefined ? '' : String(args[0]);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => { if (name && m.length) buses.send(name, m); }],
    onControlOut: () => {},
  };
}
register('send', makeSend);
register('s', makeSend);

// ── receive / r ─────────────────────────────────────────────────────────────

// receive <name> (alias `r`) : subscribe to a named bus; whatever any `send <name>`
// broadcasts is re-emitted from outlet 0. The inlet accepts `set <name>` to point at
// a different source at runtime. dispose() unsubscribes on patch reload.
function makeReceive(args: Atom[]): MaxNode {
  const o = makeOutlets();
  let unsub: (() => void) | null = null;
  const subscribe = (name: string) => {
    if (unsub) { unsub(); unsub = null; }
    if (name) unsub = buses.subscribe(name, (m) => o.emit(0, m));
  };
  subscribe(args[0] === undefined ? '' : String(args[0]));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => { if (m.length >= 2 && m[0] === 'set') subscribe(String(m[1])); }],
    onControlOut: o.onControlOut,
    dispose: () => { if (unsub) unsub(); },
  };
}
register('receive', makeReceive);
register('r', makeReceive);

// ── forward ─────────────────────────────────────────────────────────────────

// forward [receiver] : like send, but the destination is settable from the inlet.
// A message whose first atom is the symbol `send` sets the target to the next atom
// (and forwards any remaining atoms to it); any other message is forwarded to the
// current target. Manifest: 1 inlet, no outlets — it only speaks over the bus.
register('forward', (args): MaxNode => {
  let target = args[0] === undefined ? '' : String(args[0]);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (m.length >= 2 && m[0] === 'send') {
          target = String(m[1]);
          const rest = m.slice(2);
          if (rest.length && target) buses.send(target, rest as Msg);
          return;
        }
        if (target && m.length) buses.send(target, m);
      },
    ],
    onControlOut: () => {},
  };
});

// ── buddy ───────────────────────────────────────────────────────────────────

// buddy [n] : a synchroniser. It stores the latest message at each of its n inlets
// (default 2) and, once EVERY inlet has received a message since the last release,
// emits each stored message from the matching outlet together (right-to-left, as in
// Max), then re-arms. Lets several streams be re-grouped in lock-step.
register('buddy', (args): MaxNode => {
  const o = makeOutlets();
  const n = Math.max(2, Math.trunc(num(args[0], 2)));
  const stored: Msg[] = Array.from({ length: n }, () => [] as Msg);
  const ready: boolean[] = new Array(n).fill(false);
  const controlIns = Array.from({ length: n }, (_, i) => (m: Msg) => {
    stored[i] = m;
    ready[i] = true;
    if (ready.every(Boolean)) {
      for (let k = n - 1; k >= 0; k--) o.emit(k, stored[k]);
      ready.fill(false);
    }
  });
  return {
    signalIns: [],
    signalOuts: [],
    controlIns,
    onControlOut: o.onControlOut,
  };
});

// Not implemented in this batch:
//   • grab — its whole point is to REDIRECT another object's outlet back into itself
//     (bang out the right outlet, capture what the downstream object emits, and send
//     it out the left outlet instead of down its normal cords). That interception of
//     a third object's output isn't expressible in the prototype's one-way cord model.
//   • prepend2 / sprintf2 — not Max classes and absent from the manifest, so there is
//     no I/O contract to bind. The real `prepend` already ships in control/data.ts and
//     `sprintf` (0-in/0-out) is intentionally a Tier-A stub in the convert batch.
