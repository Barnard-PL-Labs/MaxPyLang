// MIDI control objects — the message-logic half of Max's MIDI family.
//
// This batch is PURE MESSAGE LOGIC: no Web MIDI I/O yet. The "in" objects
// (notein/ctlin/bendin/pgmin) model the parse-and-fan-out that a real MIDI
// driver would drive once wired up — you inject a MIDI-semantic list at inlet 0
// and they split it across their outlets. midiparse/midiformat convert between
// raw MIDI byte lists and those semantic events. makenote/stripnote/flush are
// note-stream shapers that need no hardware at all.
//
// Follows the control/index.ts REFERENCE PATTERN:
//   const o = makeOutlets();
//   return { signalIns: [], signalOuts: [], controlIns: [...], onControlOut: o.onControlOut, dispose? };
// Messages are Atom[] (runtime/atoms). Timed objects use the shared `scheduler`
// so ▶/■ start and stop their note-offs in sync with the transport.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { scheduler } from '../../runtime/scheduler';
import { firstNum, isBang, nums, type Atom, type Msg } from '../../runtime/atoms';

// Clamp a value into a MIDI 7-bit range (0..127).
const midi7 = (n: number): number => Math.max(0, Math.min(127, Math.trunc(n)));

// ── Note-stream shapers ───────────────────────────────────────────────────────

// makenote <velocity> <duration> [channel] : pair every incoming note number with
// a matching note-off `duration` ms later. inlet 0 = pitch (fires), inlet 1 =
// velocity, inlet 2 = duration. outlet 0 = pitch, outlet 1 = velocity. The note-on
// emits immediately (pitch + velocity); the scheduler emits pitch + velocity 0 when
// the duration elapses. Accepts a bare pitch or a [pitch, velocity] list at inlet 0.
register('makenote', (args) => {
  const o = makeOutlets();
  let velocity = num(args[0], 64);
  let duration = num(args[1], 250);
  const pending = new Set<() => void>();
  const fire = (pitch: number, vel: number) => {
    o.emit(0, [pitch]);
    o.emit(1, [vel]);
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const ns = nums(m);
        if (ns.length === 0) return;
        const pitch = midi7(ns[0]);
        const vel = ns.length >= 2 ? midi7(ns[1]) : midi7(velocity);
        fire(pitch, vel); // note-on
        let cancel: (() => void) | null = null;
        cancel = scheduler.afterMs(duration, () => {
          if (cancel) pending.delete(cancel);
          fire(pitch, 0); // note-off
        });
        pending.add(cancel);
      },
      (m) => { const n = firstNum(m); if (n !== undefined) velocity = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) duration = Math.max(0, n); },
    ],
    onControlOut: o.onControlOut,
    dispose: () => { for (const c of pending) c(); pending.clear(); },
  } satisfies MaxNode;
});

// stripnote : drop note-offs (velocity 0), pass note-ons through. inlet 1 stores the
// velocity, inlet 0 (pitch) fires: if the held velocity is nonzero, emit pitch
// (outlet 0) + velocity (outlet 1); otherwise stay silent. Also accepts a
// [pitch, velocity] list at inlet 0.
register('stripnote', () => {
  const o = makeOutlets();
  let velocity = 0;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const ns = nums(m);
        if (ns.length === 0) return;
        const pitch = ns[0];
        const vel = ns.length >= 2 ? ns[1] : velocity;
        if (vel !== 0) { o.emit(0, [pitch]); o.emit(1, [vel]); }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) velocity = n; },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// flush : a note tracker that can release everything it is holding. inlet 1 stores
// velocity; inlet 0 with a pitch passes the note through (outlet 0 pitch, outlet 1
// velocity) and updates the held set (nonzero velocity = held, zero = released). A
// bang at inlet 0 emits a note-off (pitch, 0) for every held note, then clears them.
register('flush', () => {
  const o = makeOutlets();
  let velocity = 0;
  const held = new Set<number>();
  const passthru = (pitch: number, vel: number) => { o.emit(0, [pitch]); o.emit(1, [vel]); };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { for (const p of held) passthru(p, 0); held.clear(); return; }
        const ns = nums(m);
        if (ns.length === 0) return;
        const pitch = ns[0];
        const vel = ns.length >= 2 ? ns[1] : velocity;
        passthru(pitch, vel);
        if (vel !== 0) held.add(pitch); else held.delete(pitch);
      },
      (m) => { const n = firstNum(m); if (n !== undefined) velocity = n; },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── Raw-byte parse / format ───────────────────────────────────────────────────

// midiparse : split a raw MIDI message (a list of bytes [status, d1, d2]) into
// per-type outlets. outlets: 0 note (pitch velocity), 1 poly-aftertouch
// (pitch pressure), 2 control (num value), 3 program, 4 channel-aftertouch,
// 5 pitch-bend (14-bit), 6 channel (1..16), 7 other/unrecognised.
register('midiparse', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const b = nums(m);
        if (b.length === 0) return;
        const status = b[0];
        if (status < 0x80) { o.emit(7, m); return; } // not a status byte
        const type = status & 0xf0;
        const channel = (status & 0x0f) + 1;
        const d1 = b[1] ?? 0;
        const d2 = b[2] ?? 0;
        switch (type) {
          case 0x80: o.emit(0, [d1, 0]); break;          // note-off -> velocity 0
          case 0x90: o.emit(0, [d1, d2]); break;         // note-on
          case 0xa0: o.emit(1, [d1, d2]); break;         // poly aftertouch
          case 0xb0: o.emit(2, [d1, d2]); break;         // control change
          case 0xc0: o.emit(3, [d1]); break;             // program change
          case 0xd0: o.emit(4, [d1]); break;             // channel aftertouch
          case 0xe0: o.emit(5, [d1 | (d2 << 7)]); break; // pitch bend (14-bit)
          default: o.emit(7, m); return;
        }
        o.emit(6, [channel]); // channel of the last message
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// midiformat [channel] : assemble raw MIDI byte lists from semantic events, the
// inverse of midiparse. inlets: 0 note [pitch velocity], 1 poly-aftertouch
// [pitch pressure], 2 control [num value], 3 program, 4 channel-aftertouch,
// 5 pitch-bend value (14-bit), 6 channel (1..16, stored). outlet 0 = byte list.
register('midiformat', (args) => {
  const o = makeOutlets();
  let channel = Math.max(1, Math.min(16, num(args[0], 1)));
  const ch = () => channel - 1;
  const twoData = (status: number) => (m: Msg) => {
    const ns = nums(m);
    if (ns.length >= 2) o.emit(0, [status | ch(), midi7(ns[0]), midi7(ns[1])]);
  };
  const oneData = (status: number) => (m: Msg) => {
    const n = firstNum(m);
    if (n !== undefined) o.emit(0, [status | ch(), midi7(n)]);
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      twoData(0x90), // note
      twoData(0xa0), // poly aftertouch
      twoData(0xb0), // control change
      oneData(0xc0), // program change
      oneData(0xd0), // channel aftertouch
      (m) => { // pitch bend: 14-bit value -> two 7-bit bytes
        const n = firstNum(m);
        if (n !== undefined) { const v = Math.max(0, Math.min(16383, Math.trunc(n))); o.emit(0, [0xe0 | ch(), v & 0x7f, (v >> 7) & 0x7f]); }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) channel = Math.max(1, Math.min(16, Math.trunc(n))); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── MIDI "in" fan-outs (message injection until Web MIDI is wired) ─────────────

// Split a MIDI-semantic list injected at inlet 0 across N outlets, left-to-right.
// A shared shape for notein/ctlin/bendin/pgmin: `layout` names the atom order of
// the injected list; each atom is routed to the outlet of the same index.
function makeSplit(layout: number): (args: Atom[]) => MaxNode {
  return (): MaxNode => {
    const o = makeOutlets();
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          const ns = nums(m);
          if (ns.length === 0) return;
          for (let i = 0; i < layout; i++) if (ns[i] !== undefined) o.emit(i, [ns[i]]);
        },
      ],
      onControlOut: o.onControlOut,
    };
  };
}

// notein : inject [pitch, velocity, channel] -> outlet 0 pitch, 1 velocity, 2 channel.
register('notein', makeSplit(3));
// ctlin : inject [controller, value, channel] -> outlet 0 value, 1 controller, 2 channel.
// (Max's ctlin puts the value on the left outlet, so map explicitly rather than 1:1.)
register('ctlin', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const ns = nums(m);
        if (ns.length === 0) return;
        const controller = ns[0];
        const value = ns[1] ?? 0;
        const channel = ns[2];
        o.emit(0, [value]);
        o.emit(1, [controller]);
        if (channel !== undefined) o.emit(2, [channel]);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});
// bendin : inject [value, channel] -> outlet 0 value, 1 channel.
register('bendin', makeSplit(2));
// pgmin : inject [program, channel] -> outlet 0 program, 1 channel.
register('pgmin', makeSplit(2));
