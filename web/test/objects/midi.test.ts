import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/objects/control/midi'; // isolate: import this batch's module directly
import { getFactory } from '../../src/engine/registry';
import { scheduler } from '../../src/runtime/scheduler';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context
const bang: Msg = ['bang'];

// Build an object and capture messages leaving one or more outlets.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const outs = new Map<number, Msg[]>();
  const capture = (outlet: number) => {
    const arr: Msg[] = [];
    outs.set(outlet, arr);
    node.onControlOut?.(outlet, (m) => arr.push(m));
    return arr;
  };
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, capture, send };
}

afterEach(() => {
  vi.useRealTimers();
  scheduler.clear();
});

describe('makenote', () => {
  it('emits a note-on immediately and a note-off after the duration', () => {
    vi.useFakeTimers();
    const { capture, send } = build('makenote', 100, 250);
    const pitch = capture(0);
    const vel = capture(1);
    scheduler.start();

    send([60]); // pitch in
    expect(pitch).toEqual([[60]]);
    expect(vel).toEqual([[100]]); // creation-arg velocity

    vi.advanceTimersByTime(250);
    expect(pitch).toEqual([[60], [60]]);
    expect(vel).toEqual([[100], [0]]); // note-off has velocity 0
  });

  it('honours velocity/duration inlets and [pitch velocity] lists', () => {
    vi.useFakeTimers();
    const { capture, send } = build('makenote', 100, 250);
    const pitch = capture(0);
    const vel = capture(1);
    scheduler.start();
    send([90], 1); // velocity
    send([50], 2); // duration
    send([64]);
    expect(vel[0]).toEqual([90]);
    vi.advanceTimersByTime(49);
    expect(pitch.length).toBe(1); // not yet
    vi.advanceTimersByTime(1);
    expect(pitch).toEqual([[64], [64]]);
  });
});

describe('stripnote', () => {
  it('passes note-ons and drops note-offs (velocity 0)', () => {
    const { capture, send } = build('stripnote');
    const pitch = capture(0);
    const vel = capture(1);
    // note-on via list
    send([60, 100]);
    // note-off via list -> dropped
    send([60, 0]);
    // via separate inlets: velocity then pitch
    send([80], 1);
    send([62]);
    expect(pitch).toEqual([[60], [62]]);
    expect(vel).toEqual([[100], [80]]);
  });
});

describe('flush', () => {
  it('passes notes through and releases all held notes on bang', () => {
    const { capture, send } = build('flush');
    const pitch = capture(0);
    const vel = capture(1);
    send([60, 100]); // held
    send([64, 100]); // held
    send([60, 0]);   // released -> untracked
    pitch.length = 0; vel.length = 0;
    send(bang); // flush -> note-off for the one still held (64)
    expect(pitch).toEqual([[64]]);
    expect(vel).toEqual([[0]]);
    // second flush: nothing held
    pitch.length = 0;
    send(bang);
    expect(pitch).toEqual([]);
  });
});

describe('midiparse', () => {
  it('routes each MIDI status type to its outlet and reports channel', () => {
    const { capture, send } = build('midiparse');
    const note = capture(0);
    const cc = capture(2);
    const bend = capture(5);
    const chan = capture(6);
    send([0x90, 60, 100]); // note-on ch1
    send([0xb2, 7, 64]);   // control change ch3
    send([0xe0, 0x00, 0x40]); // pitch bend ch1 -> 0x2000 = 8192
    expect(note).toEqual([[60, 100]]);
    expect(cc).toEqual([[7, 64]]);
    expect(bend).toEqual([[8192]]);
    expect(chan).toEqual([[1], [3], [1]]);
  });

  it('treats a note-off status as velocity 0', () => {
    const { capture, send } = build('midiparse');
    const note = capture(0);
    send([0x80, 60, 40]);
    expect(note).toEqual([[60, 0]]);
  });
});

describe('midiformat', () => {
  it('formats note / control / pitch-bend events into raw bytes on the stored channel', () => {
    const { capture, send } = build('midiformat', 1);
    const bytes = capture(0);
    send([3], 6);        // set channel 3
    send([60, 100], 0);  // note
    send([7, 64], 2);    // control change
    send([8192], 5);     // pitch bend center
    expect(bytes).toEqual([
      [0x92, 60, 100],
      [0xb2, 7, 64],
      [0xe2, 0x00, 0x40],
    ]);
  });

  it('round-trips through midiparse', () => {
    const fmt = build('midiformat', 5);
    const parse = build('midiparse');
    const note = parse.capture(0);
    const chan = parse.capture(6);
    fmt.node.onControlOut!(0, (m) => parse.node.controlIns![0]!(m));
    fmt.send([72, 88], 0); // note on channel 5
    expect(note).toEqual([[72, 88]]);
    expect(chan).toEqual([[5]]);
  });
});

describe('midi "in" fan-outs', () => {
  it('notein splits [pitch, velocity, channel]', () => {
    const { capture, send } = build('notein');
    const p = capture(0), v = capture(1), c = capture(2);
    send([60, 100, 2]);
    expect(p).toEqual([[60]]);
    expect(v).toEqual([[100]]);
    expect(c).toEqual([[2]]);
  });

  it('ctlin puts value on the left outlet, controller on the middle', () => {
    const { capture, send } = build('ctlin');
    const value = capture(0), controller = capture(1), channel = capture(2);
    send([7, 64, 1]); // controller 7, value 64, channel 1
    expect(value).toEqual([[64]]);
    expect(controller).toEqual([[7]]);
    expect(channel).toEqual([[1]]);
  });

  it('bendin / pgmin split [value, channel]', () => {
    const bend = build('bendin');
    const bv = bend.capture(0), bc = bend.capture(1);
    bend.send([8192, 4]);
    expect(bv).toEqual([[8192]]);
    expect(bc).toEqual([[4]]);

    const pgm = build('pgmin');
    const pv = pgm.capture(0), pc = pgm.capture(1);
    pgm.send([12, 1]);
    expect(pv).toEqual([[12]]);
    expect(pc).toEqual([[1]]);
  });
});
