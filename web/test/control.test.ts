import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../src/objects'; // bootstrap (registers control objects + stubs)
import { getFactory } from '../src/engine/registry';
import { scheduler } from '../src/runtime/scheduler';
import type { Msg } from '../src/runtime/atoms';
import { parseMaxPat } from '../src/parser/maxpat';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context

// Build a control object and capture messages leaving outlet 0. Messages are
// Atom[]; `vals()` flattens single-number messages for easy assertions.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const out: Msg[] = [];
  node.onControlOut?.(0, (m) => out.push(m));
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  const vals = () => out.map((m) => m[0]);
  return { node, out, vals, send };
}
const bang: Msg = ['bang'];

afterEach(() => {
  vi.useRealTimers();
  scheduler.clear(); // reset the shared transport between tests
});

describe('control objects', () => {
  it('counter wraps min..max on each bang', () => {
    const { vals, send } = build('counter', 0, 3);
    for (let i = 0; i < 6; i++) send(bang);
    expect(vals()).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('random stays within [0, N) and respects inlet 1', () => {
    const { out, vals, send } = build('random', 4);
    for (let i = 0; i < 20; i++) send(bang);
    expect(vals().every((v) => typeof v === 'number' && v >= 0 && v < 4)).toBe(true);
    send([10], 1);
    out.length = 0;
    for (let i = 0; i < 50; i++) send(bang);
    expect(Math.max(...(vals() as number[]))).toBeGreaterThan(3);
  });

  it('control math: left inlet triggers, right inlet stores the operand', () => {
    const { vals, send } = build('+', 60);
    send([5]);
    send([10], 1);
    send([5]);
    expect(vals()).toEqual([65, 15]);
  });

  it('mtof maps MIDI 69 -> 440 Hz', () => {
    const { out, send } = build('mtof');
    send([69]);
    expect(out[0][0]).toBeCloseTo(440, 5);
  });

  it('toggle flips on bang, sets on number', () => {
    const { vals, send } = build('toggle');
    send(bang);
    send(bang);
    send([5]);
    expect(vals()).toEqual([1, 0, 1]);
  });

  it('the full arp chain metro->counter->+->mtof yields an ascending scale', () => {
    vi.useFakeTimers();
    const metro = build('metro', 100);
    const counter = getFactory('counter')!([0, 3], { ctx });
    const add = getFactory('+')!([60], { ctx });
    const mtof = getFactory('mtof')!([], { ctx });
    const freqs: number[] = [];
    metro.node.onControlOut!(0, (m) => counter.controlIns![0]!(m));
    counter.onControlOut!(0, (m) => add.controlIns![0]!(m));
    add.onControlOut!(0, (m) => mtof.controlIns![0]!(m));
    mtof.onControlOut!(0, (m) => freqs.push(m[0] as number));

    scheduler.start(); // transport ▶ — metro auto-started at build, now ticks
    vi.advanceTimersByTime(350); // 3 ticks -> MIDI 60,61,62

    expect(freqs.length).toBe(3);
    expect(freqs[0]).toBeCloseTo(261.63, 1); // C4
    expect(freqs[1]).toBeGreaterThan(freqs[0]);
    expect(freqs[2]).toBeGreaterThan(freqs[1]);
  });

  it('metro ticks only while the transport runs, and stops cleanly', () => {
    vi.useFakeTimers();
    const { out } = build('metro', 100); // on by default
    scheduler.start();
    vi.advanceTimersByTime(350);
    expect(out.length).toBe(3);
    scheduler.stop();
    vi.advanceTimersByTime(500);
    expect(out.length).toBe(3); // no ticks after ■
    expect(out.every((m) => m[0] === 'bang')).toBe(true);
  });
});

describe('arpeggiator patch wiring', () => {
  const json = JSON.parse(
    readFileSync(fileURLToPath(new URL('../public/test-patches/arpeggiator.maxpat', import.meta.url)), 'utf-8')
  );

  it('types cords: control up to the oscillator, signal after it', () => {
    const patch = parseMaxPat(json);
    const cordDomain = (fromText: string) => {
      const src = patch.nodes.find((n) => n.text === fromText)!;
      return patch.edges.find((e) => e.from.id === src.id)!.domain;
    };
    expect(cordDomain('metro 220')).toBe('control');
    expect(cordDomain('mtof')).toBe('control');
    expect(cordDomain('cycle~')).toBe('signal');
  });
});
