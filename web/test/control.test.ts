import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../src/objects/control'; // registers control objects
import { getFactory, type ControlValue } from '../src/engine/registry';
import { parseMaxPat } from '../src/parser/maxpat';

// Control objects ignore the audio context, so we can build and drive them with
// no AudioContext — just feed controlIns and capture what leaves outlet 0.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx: {} as BaseAudioContext });
  const out: ControlValue[] = [];
  node.onControlOut?.(0, (v) => out.push(v));
  const send = (v: ControlValue, inlet = 0) => node.controlIns?.[inlet]?.(v);
  return { node, out, send };
}

afterEach(() => vi.useRealTimers());

describe('control objects', () => {
  it('counter wraps min..max on each bang', () => {
    const { out, send } = build('counter', 0, 3);
    for (let i = 0; i < 6; i++) send('bang');
    expect(out).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('random stays within [0, N) and respects inlet 1', () => {
    const { out, send } = build('random', 4);
    for (let i = 0; i < 20; i++) send('bang');
    expect(out.every((v) => typeof v === 'number' && v >= 0 && v < 4)).toBe(true);
    send(10, 1); // widen range
    out.length = 0;
    for (let i = 0; i < 50; i++) send('bang');
    expect(Math.max(...(out as number[]))).toBeGreaterThan(3);
  });

  it('control math: left inlet triggers, right inlet stores the operand', () => {
    const { out, send } = build('+', 60);
    send(5);          // 5 + 60
    send(10, 1);      // store operand 10 (no output)
    send(5);          // 5 + 10
    expect(out).toEqual([65, 15]);
  });

  it('mtof maps MIDI 69 -> 440 Hz', () => {
    const { out, send } = build('mtof');
    send(69);
    expect(out[0]).toBeCloseTo(440, 5);
  });

  it('toggle flips on bang, sets on number', () => {
    const { out, send } = build('toggle');
    send('bang'); // 0 -> 1
    send('bang'); // 1 -> 0
    send(5);      // nonzero -> 1
    expect(out).toEqual([1, 0, 1]);
  });

  it('the full arp chain metro->counter->+->mtof yields an ascending scale', () => {
    vi.useFakeTimers();
    // Wire the control chain exactly as the engine would (outlet 0 -> inlet 0).
    const metro = build('metro', 100);
    const counter = getFactory('counter')!([0, 3], { ctx: {} as BaseAudioContext });
    const add = getFactory('+')!([60], { ctx: {} as BaseAudioContext });
    const mtof = getFactory('mtof')!([], { ctx: {} as BaseAudioContext });
    const freqs: number[] = [];
    metro.node.onControlOut!(0, (v) => counter.controlIns![0]!(v));
    counter.onControlOut!(0, (v) => add.controlIns![0]!(v));
    add.onControlOut!(0, (v) => mtof.controlIns![0]!(v));
    mtof.onControlOut!(0, (v) => freqs.push(v as number));

    metro.node.start!();
    vi.advanceTimersByTime(350); // 3 ticks -> MIDI 60,61,62

    expect(freqs.length).toBe(3);
    expect(freqs[0]).toBeCloseTo(261.63, 1); // C4
    expect(freqs[1]).toBeGreaterThan(freqs[0]); // rising
    expect(freqs[2]).toBeGreaterThan(freqs[1]);
    metro.node.stop!();
  });

  it('metro bangs on the transport clock and stops cleanly', () => {
    vi.useFakeTimers();
    const { node, out } = build('metro', 100);
    node.start!();            // transport ▶ auto-starts it
    vi.advanceTimersByTime(350);
    expect(out.length).toBe(3);
    node.stop!();             // transport ■
    vi.advanceTimersByTime(500);
    expect(out.length).toBe(3); // no more bangs after stop
    expect(out.every((v) => v === 'bang')).toBe(true);
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
    expect(cordDomain('metro 220')).toBe('control'); // metro -> counter
    expect(cordDomain('mtof')).toBe('control');      // mtof -> cycle~ (drives frequency)
    expect(cordDomain('cycle~')).toBe('signal');     // cycle~ -> *~
  });
});
