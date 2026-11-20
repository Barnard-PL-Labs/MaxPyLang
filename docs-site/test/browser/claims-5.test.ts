// Group 5 claims: UI objects, MSP operators, MIDI objects, distortion and output.
// Every test quotes the text it holds the example to. Where the engine, the example or
// maxpylang is wrong for Max, the test is `it.fails('BUG: ...')` and the comment cites
// Max's reference page and the engine file.
//
// `play` below is the helper's `run` with one addition: actions at given audio times
// (click a widget, type into a number box, send a box a message), so that what the text
// says happens "when you drag/click" can be measured rather than only read.
import { describe, expect, it, vi } from 'vitest';
import { example, boxIds, SR, pitch, rms, peak, firsts, type Heard, type Listen } from './helpers/measure';
import { Engine } from '../../../web/src/engine/engine';
import { parseMaxPat } from '../../../web/src/parser/maxpat';
import { preloadWorklets } from '../../../web/src/runtime/worklet';
import { simulateKey, simulateKeyUp } from '../../../web/src/objects/control/triggers';

type Atom = number | string;
type Node = {
  el?: HTMLElement;
  controlIns?: (((m: Atom[]) => void) | undefined)[];
  onControlOut?: (o: number, cb: (m: Atom[]) => void) => void;
};
interface H {
  node(name: string, nth?: number): Node;
  el<T extends HTMLElement = HTMLElement>(name: string, nth?: number): T;
  send(name: string, inlet: number, msg: Atom[], nth?: number): void;
}
interface Act { t: number; act: (h: H) => void }
interface Played { left: Float32Array; right: Float32Array; heard: Record<string, Heard[]>; h: H }

const STEP = 0.01;

async function play(object: string, index: number, opts: { seconds?: number; listen?: Listen[]; at?: Act[] } = {}): Promise<Played> {
  const ex = example(object, index);
  const seconds = opts.seconds ?? 2;
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
  let seed = 1;
  const rand = vi.spyOn(Math, 'random').mockImplementation(() => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const engine = new Engine(ctx);
  try {
    await preloadWorklets(ctx);
    engine.build(parseMaxPat(ex.patch));
    // a copy: the engine empties its own map when it is cleared, and tests read elements after
    const nodes = new Map((engine as unknown as { nodes: Map<string, Node> }).nodes);
    const node = (name: string, nth = 0): Node => {
      const id = boxIds(ex, name)[nth];
      const n = id && nodes.get(id);
      if (!n) throw new Error(`${object}/${index} has no box "${name}" #${nth}`);
      return n;
    };
    const h: H = {
      node,
      el: <T extends HTMLElement>(name: string, nth = 0) => {
        const e = node(name, nth).el;
        if (!e) throw new Error(`"${name}" has no element`);
        return e as T;
      },
      send: (name, inlet, msg, nth = 0) => {
        const f = node(name, nth).controlIns?.[inlet];
        if (!f) throw new Error(`"${name}" inlet ${inlet} takes no messages`);
        f(msg);
      },
    };
    let now = 0;
    const heard: Record<string, Heard[]> = {};
    for (const l of opts.listen ?? []) {
      const label = l.label ?? l.box;
      heard[label] = [];
      node(l.box, l.nth).onControlOut?.(l.outlet ?? 0, (m) => heard[label].push({ t: now, msg: [...m] }));
    }
    const todo = [...(opts.at ?? [])].sort((a, b) => a.t - b.t);
    await engine.start();
    for (let t = STEP; t < seconds; t += STEP) {
      const at = (Math.round((t * SR) / 128) * 128) / SR;
      if (at >= seconds - 1 / SR) break;
      void ctx.suspend(at).then(() => {
        now = at;
        while (todo.length && todo[0].t <= at + 1e-9) todo.shift()!.act(h);
        vi.advanceTimersByTime(STEP * 1000);
        void ctx.resume();
      });
    }
    const buffer = await ctx.startRendering();
    return { left: buffer.getChannelData(0).slice(), right: buffer.getChannelData(1).slice(), heard, h };
  } finally {
    await engine.stop();
    engine.clear();
    rand.mockRestore();
    vi.useRealTimers();
  }
}

// ── measuring ────────────────────────────────────────────────────────────────

const seg = (x: Float32Array, t0: number, t1: number) => x.subarray(Math.round(t0 * SR), Math.round(t1 * SR));

/** Amplitude of the sinusoid at f Hz between t0 and t1 (Hann-windowed DFT bin). */
function tone(x: Float32Array, t0: number, t1: number, f: number): number {
  const s = seg(x, t0, t1);
  const N = s.length;
  let re = 0, im = 0, ws = 0;
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    const a = (2 * Math.PI * f * i) / SR;
    re += w * s[i] * Math.cos(a);
    im -= w * s[i] * Math.sin(a);
    ws += w;
  }
  return (2 * Math.hypot(re, im)) / ws;
}

/** How many times a second the loudness swells: upward crossings of its mid level. */
function swells(x: Float32Array, t0: number, t1: number, win = 0.01): number {
  const env: number[] = [];
  for (let t = t0; t + win <= t1 + 1e-9; t += win) env.push(rms(x, t, t + win));
  const lo = Math.min(...env), hi = Math.max(...env), mid = (lo + hi) / 2, band = 0.15 * (hi - lo);
  const ups: number[] = [];
  let state = env[0] > mid ? 1 : 0;
  env.forEach((e, i) => {
    if (state === 0 && e > mid + band) { ups.push(i * win); state = 1; }
    else if (state === 1 && e < mid - band) state = 0;
  });
  return ups.length < 2 ? 0 : (ups.length - 1) / (ups[ups.length - 1] - ups[0]);
}

/** Zero crossings per second. */
function crossingsPerSec(x: Float32Array, t0: number, t1: number): number {
  const s = seg(x, t0, t1);
  let n = 0;
  for (let i = 1; i < s.length; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) n++;
  return n / (t1 - t0);
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
/** Within 1% (pitch() reads whole-sample lags, so ~0.5% off at 400 Hz). */
const near = (f: number, want: number, tol = 0.01) => expect(Math.abs(f / want - 1)).toBeLessThan(tol);
const rgbOf = (css: string) => css.replace(/\s/g, '');
const at = (heard: Heard[], t: number) => heard.filter((x) => Math.abs(x.t - t) < 0.015);
/** The ratio of a saw's 20th harmonic to its fundamental: how bright the filter leaves it. */
const brightness = (x: Float32Array, t0: number, t1: number, f0: number) => tone(x, t0, t1, 20 * f0) / tone(x, t0, t1, f0);
/** Set a range/number input as a drag or typing would, firing its input event. */
function typeInto(el: HTMLInputElement, v: number | string) {
  el.value = String(v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const box = (object: string, index: number, name: string) => {
  const ex = example(object, index);
  const id = boxIds(ex, name)[0];
  return ex.patch.patcher.boxes.find((b) => b.box.id === id)!.box as unknown as Record<string, unknown>;
};

// ════════════════════════════════════════════════════════════════════════════
// Interface objects
// ════════════════════════════════════════════════════════════════════════════

describe('button/0: Click to pluck', () => {
  it('"metro bangs it twice a second and each bang plucks a note" (440 Hz, a 300 ms pluck)', async () => {
    const r = await play('button', 0, { seconds: 1.3, listen: [{ box: 'button' }] });
    expect(r.heard.button.map((x) => x.t)).toEqual([0, expect.closeTo(0.5, 1), expect.closeTo(1.0, 1)]);
    expect(r.heard.button.every((x) => x.msg[0] === 'bang')).toBe(true);
    expect(pitch(r.left, 0.01, 0.12)).toBeCloseTo(440, -1);
    expect(peak(r.left, 0, 0.05)).toBeCloseTo(0.2, 2);            // line~ to 1, *~ 0.2
    expect(rms(r.left, 0.32, 0.48)).toBeLessThan(1e-3);            // the pluck is over by 305 ms
    expect(rms(r.left, 0.51, 0.6)).toBeGreaterThan(0.05);          // the next one
  });
  it('"flashes whenever a bang passes through it" and "click the button to add notes"', async () => {
    let lit = '', dark = '';
    const r = await play('button', 0, {
      seconds: 1.3,
      listen: [{ box: 'button' }],
      at: [
        { t: 0.53, act: (h) => { lit = rgbOf(h.el('button').style.background); } },
        { t: 0.8, act: (h) => { dark = rgbOf(h.el('button').style.background); h.el('button').click(); } },
      ],
    });
    expect(lit).toBe('rgb(230,233,239)');                         // bright just after the metro's bang
    expect(dark).toBe('rgb(26,29,34)');                           // back to dark between bangs
    expect(r.heard.button).toHaveLength(4);                       // three metro bangs + the click
    expect(at(r.heard.button, 0.8)).toHaveLength(1);
    expect(rms(r.left, 0.82, 0.9)).toBeGreaterThan(0.05);         // the click plucked a note
  });
});

describe('comment/0: Label a patch', () => {
  it('"it has no outlets and makes no sound"; "drag the slider to change the pitch"', async () => {
    expect(box('comment', 0, 'comment').numoutlets ?? 0).toBe(0);
    const r = await play('comment', 0, {
      seconds: 1.5,
      listen: [{ box: 'scale' }],
      at: [
        { t: 0.5, act: (h) => typeInto(h.el<HTMLInputElement>('slider'), 127) },
        { t: 1.0, act: (h) => typeInto(h.el<HTMLInputElement>('slider'), 0) },
      ],
    });
    expect(r.h.node('comment').onControlOut).toBeUndefined();
    expect(pitch(r.left, 0.1, 0.45)).toBeCloseTo(330, -1);          // cycle~ 330 until dragged
    expect(pitch(r.left, 0.55, 0.95)).toBeCloseTo(800, -1);         // slider top -> 800 Hz
    expect(pitch(r.left, 1.05, 1.45)).toBeCloseTo(200, -1);         // slider bottom -> 200 Hz
  });
});

describe('comment/0: the comment\'s text', () => {
  // Max shows a comment box's saved "text" as it is. maxpylang saves this one as
  // "comment drag the slider to change the pitch", so Max (and the engine, which shows the
  // saved text verbatim like Max: web/src/objects/ui/display.ts, commentText) displays the
  // word "comment" in front of the instructions.
  it.fails('BUG (maxpylang): the comment reads "drag the slider to change the pitch", not "comment drag the slider ..."', async () => {
    expect(box('comment', 0, 'comment drag the slider to change the pitch').text).toBe('drag the slider to change the pitch');
  });
  it('the engine shows the saved text as Max would', async () => {
    const r = await play('comment', 0, { seconds: 0.1 });
    expect(r.h.el('comment').textContent).toBe(box('comment', 0, 'comment drag the slider to change the pitch').text);
  });
});

describe('dial/0: Turn a dial to open a filter', () => {
  it('"A dial sends 0..127 ... scale maps that onto a cutoff of 200..4000 Hz ... brighter and darker"', async () => {
    const r = await play('dial', 0, {
      seconds: 1.5,
      listen: [{ box: 'dial' }, { box: 'scale' }],
      at: [
        { t: 0.5, act: (h) => typeInto(h.el<HTMLInputElement>('dial'), 127) },
        { t: 1.0, act: (h) => typeInto(h.el<HTMLInputElement>('dial'), 0) },
      ],
    });
    const d = r.h.el<HTMLInputElement>('dial');
    expect([d.min, d.max]).toEqual(['0', '127']);
    expect(firsts(r.heard.dial)).toEqual([127, 0]);
    expect(firsts(r.heard.scale)).toEqual([4000, 200]);
    const at600 = brightness(r.left, 0.1, 0.45, 110), at4000 = brightness(r.left, 0.6, 0.95, 110), at200 = brightness(r.left, 1.1, 1.45, 110);
    expect(at4000).toBeGreaterThan(5 * at600);                       // brighter
    expect(at200).toBeLessThan(at600 / 5);                           // darker
  });
});

describe('flonum/0: Set the speed of a tremolo', () => {
  it('"4 swells a second until you change it ... type 0.5 for a slow swell or 12 for a fast flutter"', async () => {
    const r = await play('flonum', 0, {
      seconds: 4.6,
      listen: [{ box: 'flonum' }],
      at: [
        { t: 1.0, act: (h) => typeInto(h.el<HTMLInputElement>('flonum'), 12) },
        { t: 2.0, act: (h) => typeInto(h.el<HTMLInputElement>('flonum'), 0.5) },
      ],
    });
    expect(firsts(r.heard.flonum)).toEqual([12, 0.5]);              // decimals survive
    expect(swells(r.left, 0, 1)).toBeCloseTo(4, 0);
    expect(swells(r.left, 1.02, 1.98)).toBeGreaterThan(11);
    expect(swells(r.left, 1.02, 1.98)).toBeLessThan(13.5);
    expect(swells(r.left, 2.05, 4.55, 0.05)).toBeLessThanOrEqual(0.8); // ~one swell in 2.5 s
    expect(peak(r.left, 0, 1)).toBeCloseTo(0.2, 2);                    // swell reaches *~ 0.2
  });
});

describe('incdec/0: Step through the semitones', () => {
  it('"each click adds or subtracts 1 and sends the new number ... walk the pitch one semitone at a time"', async () => {
    const arrow = (h: H, i: number) => (h.el('incdec').children[i] as HTMLElement).click();
    const r = await play('incdec', 0, {
      seconds: 1.6,
      listen: [{ box: 'incdec' }, { box: '+ 60' }],
      at: [{ t: 0.4, act: (h) => arrow(h, 0) }, { t: 0.8, act: (h) => arrow(h, 0) }, { t: 1.2, act: (h) => arrow(h, 1) }],
    });
    expect(firsts(r.heard.incdec)).toEqual([1, 2, 1]);
    expect(firsts(r.heard['+ 60'])).toEqual([61, 62, 61]);
    expect(pitch(r.left, 0.05, 0.35)).toBeCloseTo(262, -1);
    expect(pitch(r.left, 0.45, 0.75)).toBeCloseTo(mtof(61), -1);
    expect(pitch(r.left, 0.85, 1.15)).toBeCloseTo(mtof(62), -1);
    expect(pitch(r.left, 1.25, 1.55)).toBeCloseTo(mtof(61), -1);
  });
});

describe('key/0: Play with your computer keyboard', () => {
  it('"% 12 folds every code into one octave, + 60 starts it at middle C, and mtof turns it into hertz"', async () => {
    const r = await play('key', 0, {
      seconds: 1.2,
      listen: [{ box: '+ 60' }],
      at: [{ t: 0.4, act: () => simulateKey(97) }, { t: 0.8, act: () => simulateKey(100) }],   // 'a', 'd'
    });
    expect(firsts(r.heard['+ 60'])).toEqual([61, 64]);              // 97 % 12 = 1, 100 % 12 = 4
    expect(pitch(r.left, 0.05, 0.35)).toBeCloseTo(262, -1);
    expect(pitch(r.left, 0.45, 0.75)).toBeCloseTo(mtof(61), -1);
    expect(pitch(r.left, 0.85, 1.15)).toBeCloseTo(mtof(64), -1);
  });
  // Max key's left outlet is "the ASCII value of the pressed key (i.e., it outputs the text
  // character rather than the code for the key)": 'a' is 97. The engine's keyboard bridge
  // (web/src/objects/control/triggers.ts, codeOf) sends KeyboardEvent.keyCode, 65 for 'a'.
  it.fails('BUG: a real "a" key press sends its keyCode 65, not Max\'s character code 97', async () => {
    const r = await play('key', 0, {
      seconds: 0.5,
      listen: [{ box: 'key' }],
      at: [{ t: 0.2, act: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65 } as KeyboardEventInit)) }],
    });
    expect(firsts(r.heard.key)).toEqual([97]);
  });
  // % 12 leaves twelve notes for ~50 keys, so e.g. "a" (97) and "m" (109) play the same note.
  it.fails('BUG (text): "each key plays its own note" -- the 26 letters give only 12 notes', async () => {
    const codes = Array.from({ length: 26 }, (_, i) => 97 + i);
    const r = await play('key', 0, { seconds: 0.4, listen: [{ box: '+ 60' }], at: [{ t: 0.1, act: () => codes.forEach((c) => simulateKey(c)) }] });
    expect(new Set(firsts(r.heard['+ 60'])).size).toBe(26);
  });
});

describe('keyup/0: Hold a key for a higher note', () => {
  it('"Pressing any key sends 440 to cycle~ and letting go sends 220"', async () => {
    const r = await play('keyup', 0, {
      seconds: 1.4,
      listen: [{ box: ' 440' }, { box: ' 220' }],
      at: [{ t: 0.4, act: () => simulateKey(65) }, { t: 0.9, act: () => simulateKeyUp(65) }],
    });
    expect(firsts(r.heard[' 440'])).toEqual([440]);
    expect(firsts(r.heard[' 220'])).toEqual([220]);
    expect(pitch(r.left, 0.05, 0.35)).toBeCloseTo(220, -1);
    expect(pitch(r.left, 0.45, 0.85)).toBeCloseTo(440, -1);
    expect(pitch(r.left, 0.95, 1.35)).toBeCloseTo(220, -1);
  });
});

describe('kslider/0: Play notes on a keyboard', () => {
  it('"clicking a key sends its MIDI note number ... a metro plucks four times a second"', async () => {
    const r = await play('kslider', 0, {
      seconds: 1.6,
      listen: [{ box: 'kslider' }, { box: 'metro' }],
      at: [{ t: 0.6, act: (h) => (h.el('kslider').children[7] as HTMLElement).click() }],   // the G above middle C
    });
    expect(firsts(r.heard.kslider)).toEqual([67]);
    expect(r.heard.metro.length).toBe(7);                             // 0, .25 ... 1.5: four a second
    expect(pitch(r.left, 0.01, 0.15)).toBeCloseTo(262, -1);
    expect(pitch(r.left, 0.76, 0.9)).toBeCloseTo(mtof(67), -1);
    expect(rms(r.left, 0.21, 0.245)).toBeLessThan(1e-3);              // 205 ms pluck, then silence
    expect(rms(r.left, 0.26, 0.3)).toBeGreaterThan(0.03);
  });
});

describe('led/0: A light on the beat', () => {
  it('"counter alternates 0 and 1 on every metro tick, which lights the led and also picks the higher of two notes"', async () => {
    const bg: string[] = [];
    const r = await play('led', 0, {
      seconds: 1.25,
      listen: [{ box: 'counter' }, { box: 'led' }],
      at: [0.15, 0.45, 0.75, 1.05].map((t) => ({ t, act: (h: H) => bg.push(rgbOf(h.el('led').style.background)) })),
    });
    expect(firsts(r.heard.counter)).toEqual([0, 1, 0, 1, 0]);
    expect(firsts(r.heard.led)).toEqual([0, 1, 0, 1, 0]);
    expect(bg).toEqual(['rgb(58,13,11)', 'rgb(238,59,48)', 'rgb(58,13,11)', 'rgb(238,59,48)']);  // dark, lit, ...
    expect(pitch(r.left, 0.05, 0.28)).toBeCloseTo(mtof(60), -1);
    expect(pitch(r.left, 0.35, 0.58)).toBeCloseTo(mtof(67), -1);     // lit on the high note
  });
});

describe('matrixctrl/0: A grid of notes', () => {
  it('"clicking a cell sends the list column row value ... each column is a semitone up and each row a fourth up, counted from C3"', async () => {
    // a click on a cell's checkbox (Chrome fires no change event for a detached checkbox's click())
    const cell = (h: H, c: number, r: number) => {
      const cb = h.el('matrixctrl').children[r].children[c] as HTMLInputElement;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const r = await play('matrixctrl', 0, {
      seconds: 1.6,
      listen: [{ box: 'matrixctrl' }, { box: '+ 48' }],
      at: [{ t: 0.3, act: (h) => cell(h, 2, 1) }, { t: 0.7, act: (h) => cell(h, 0, 2) }, { t: 1.1, act: (h) => cell(h, 3, 0) }],
    });
    expect(r.heard.matrixctrl.map((x) => x.msg)).toEqual([[2, 1, 1], [0, 2, 1], [3, 0, 1]]);
    expect(firsts(r.heard['+ 48'])).toEqual([48 + 2 + 5, 48 + 10, 48 + 3]);
    expect(pitch(r.left, 0.05, 0.25)).toBeCloseTo(131, -1);           // note 48 before any click
    expect(pitch(r.left, 0.35, 0.65)).toBeCloseTo(mtof(55), -1);
    expect(pitch(r.left, 0.75, 1.05)).toBeCloseTo(mtof(58), -1);
    expect(pitch(r.left, 1.15, 1.55)).toBeCloseTo(mtof(51), -1);
  });
});

describe('message/0: Click a message to change the note', () => {
  it('"These three send 262, 330 and 392, the hertz of C, E and G, to cycle~"', async () => {
    const r = await play('message', 0, {
      seconds: 1.2,
      listen: [{ box: ' 330', label: 'e' }, { box: ' 392', label: 'g' }, { box: ' 262', label: 'c' }],
      at: [
        { t: 0.3, act: (h) => h.el(' 330').click() },
        { t: 0.6, act: (h) => h.el(' 392').click() },
        { t: 0.9, act: (h) => h.el(' 262').click() },
      ],
    });
    expect([firsts(r.heard.c), firsts(r.heard.e), firsts(r.heard.g)]).toEqual([[262], [330], [392]]);
    expect(pitch(r.left, 0.35, 0.55)).toBeCloseTo(330, -1);
    expect(pitch(r.left, 0.65, 0.85)).toBeCloseTo(392, -1);
    expect(pitch(r.left, 0.95, 1.15)).toBeCloseTo(262, -1);
    expect([mtof(60), mtof(64), mtof(67)].map(Math.round)).toEqual([262, 330, 392]);   // they are C, E, G
  });
});

describe('multislider/0: A volume fader', () => {
  it('"drag the multislider to the bottom to silence the tone and to the top for full volume"', async () => {
    const r = await play('multislider', 0, {
      seconds: 1.2,
      listen: [{ box: 'multislider' }],
      at: [
        { t: 0.4, act: (h) => typeInto(h.el('multislider').children[0] as HTMLInputElement, 0) },
        { t: 0.8, act: (h) => typeInto(h.el('multislider').children[0] as HTMLInputElement, 1) },
      ],
    });
    expect(firsts(r.heard.multislider)).toEqual([0, 1]);
    expect(rms(r.left, 0.05, 0.35)).toBeCloseTo((0.5 * 0.2) / Math.SQRT2, 3);   // half volume at first
    expect(rms(r.left, 0.45, 0.75)).toBeLessThan(1e-4);
    expect(rms(r.left, 0.85, 1.15)).toBeCloseTo(0.2 / Math.SQRT2, 3);
  });
  // Max's multislider is an INTEGER slider by default ("The default is integer (settype 0)",
  // multislider.maxref), so with setminmax 0..1 it only ever sends 0 or 1: a switch, not a
  // fader. The example must also set settype 1. (Its comment "Max's default is -1..1" is
  // wrong too: that is the float default; the integer default is 0..127.) The engine's
  // multislider (web/src/objects/ui/menus.ts) ignores settype/setminmax and its range
  // input has the default step of 1, so it snaps to 0/1 as well.
  it.fails('BUG (example): the box is not a float multislider (settype 1), so it cannot fade', () => {
    expect(box('multislider', 0, 'multislider').settype).toBe(1);
  });
  it.fails('BUG (engine): halfway up should send 0.5 (half volume); the engine\'s slider snaps to 0 or 1', async () => {
    const r = await play('multislider', 0, {
      seconds: 0.5, listen: [{ box: 'multislider' }],
      at: [{ t: 0.2, act: (h) => typeInto(h.el('multislider').children[0] as HTMLInputElement, 0.5) }],
    });
    expect(firsts(r.heard.multislider)).toEqual([0.5]);
  });
});

describe('nslider/0: Choose a note on the staff', () => {
  it('"sends its MIDI note number when you change it ... (60 is middle C)"', async () => {
    const field = (h: H) => h.el('nslider').querySelector('input') as HTMLInputElement;
    const r = await play('nslider', 0, {
      seconds: 1.2,
      listen: [{ box: 'nslider' }],
      at: [{ t: 0.4, act: (h) => typeInto(field(h), 72) }, { t: 0.8, act: (h) => typeInto(field(h), 60) }],
    });
    expect(firsts(r.heard.nslider)).toEqual([72, 60]);
    expect(pitch(r.left, 0.05, 0.35)).toBeCloseTo(262, -1);
    expect(pitch(r.left, 0.45, 0.75)).toBeCloseTo(mtof(72), -1);
    expect(pitch(r.left, 0.85, 1.15)).toBeCloseTo(mtof(60), -1);
  });
});

describe('number/0: Type a note number', () => {
  it('"click it and type a note (60 is middle C, 72 an octave up)"', async () => {
    const r = await play('number', 0, {
      seconds: 1.2,
      listen: [{ box: 'number' }],
      at: [
        { t: 0.4, act: (h) => typeInto(h.el<HTMLInputElement>('number'), 72) },
        { t: 0.8, act: (h) => typeInto(h.el<HTMLInputElement>('number'), 60.7) },   // a whole number box
      ],
    });
    expect(firsts(r.heard.number)).toEqual([72, 60]);
    expect(pitch(r.left, 0.45, 0.75)).toBeCloseTo(mtof(72), -1);
    expect(pitch(r.left, 0.85, 1.15)).toBeCloseTo(mtof(60), -1);
  });
  // "drag up and down on the number box": the engine's number/flonum field is a plain
  // <input type=number> with no drag handler (web/src/objects/control/index.ts, makeStore);
  // checked by reading only -- see the report.
});

describe('panel/0: A coloured background', () => {
  it('"It has no outlets and makes no sound ... a metro plucking a note"', async () => {
    expect(box('panel', 0, 'panel').numoutlets ?? 0).toBe(0);
    const r = await play('panel', 0, { seconds: 1.0, listen: [{ box: 'metro' }] });
    expect(r.h.node('panel').onControlOut).toBeUndefined();
    expect(r.heard.metro.map((x) => x.t)).toEqual([0, expect.closeTo(0.4, 1), expect.closeTo(0.8, 1)]);
    expect(pitch(r.left, 0.01, 0.12)).toBeCloseTo(392, -1);
    expect(rms(r.left, 0.32, 0.39)).toBeLessThan(1e-3);
  });
});

describe('pictslider/0: Two controls in one', () => {
  it('"left-right is sent from its left outlet, up-down from its right, each 0..127 ... pitch of saw~ and the cutoff of lores~"', async () => {
    const range = (h: H, i: number) => h.el('pictslider').children[i] as HTMLInputElement;
    const r = await play('pictslider', 0, {
      seconds: 2.0,
      listen: [{ box: 'pictslider', outlet: 0, label: 'x' }, { box: 'pictslider', outlet: 1, label: 'y' }],
      at: [
        { t: 0.4, act: (h) => typeInto(range(h, 0), 127) },
        { t: 0.8, act: (h) => typeInto(range(h, 0), 0) },
        { t: 1.2, act: (h) => typeInto(range(h, 1), 127) },
        { t: 1.6, act: (h) => typeInto(range(h, 1), 0) },
      ],
    });
    expect(firsts(r.heard.x)).toEqual([127, 0]);
    expect(firsts(r.heard.y)).toEqual([127, 0]);
    expect(pitch(r.left, 0.05, 0.35)).toBeCloseTo(110, -1);
    expect(pitch(r.left, 0.45, 0.75)).toBeCloseTo(220, -1);            // right: 220 Hz
    expect(pitch(r.left, 0.85, 1.15)).toBeCloseTo(55, 0);              // left: 55 Hz
    expect(brightness(r.left, 1.25, 1.55, 55)).toBeGreaterThan(5 * brightness(r.left, 1.65, 1.95, 55)); // up opens it
  });
});

describe('radiogroup/0: Pick a harmonic', () => {
  it('"clicking one sends its number, from 0 at the top ... 110, 220, 330 and 440 Hz"', async () => {
    const press = (h: H, i: number) => h.el('radiogroup').children[i].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const r = await play('radiogroup', 0, {
      seconds: 1.6,
      listen: [{ box: 'radiogroup' }],
      at: [{ t: 0.3, act: (h) => press(h, 1) }, { t: 0.6, act: (h) => press(h, 2) }, { t: 0.9, act: (h) => press(h, 3) }, { t: 1.2, act: (h) => press(h, 0) }],
    });
    expect(r.h.el('radiogroup').children).toHaveLength(4);
    expect(firsts(r.heard.radiogroup)).toEqual([1, 2, 3, 0]);
    expect(pitch(r.left, 0.05, 0.28)).toBeCloseTo(110, -1);
    expect(pitch(r.left, 0.35, 0.58)).toBeCloseTo(220, -1);
    expect(pitch(r.left, 0.65, 0.88)).toBeCloseTo(330, -1);
    expect(pitch(r.left, 0.95, 1.18)).toBeCloseTo(440, -1);
    expect(pitch(r.left, 1.25, 1.55)).toBeCloseTo(110, -1);
  });
});

describe('rslider/0: Stretch an interval', () => {
  it('"the low end from its left outlet, the high end from its right. Each end sets the pitch of one cycle~"', async () => {
    const end = (h: H, i: number) => h.el('rslider').children[i] as HTMLInputElement;
    const r = await play('rslider', 0, {
      seconds: 1.2,
      listen: [{ box: 'rslider', outlet: 0, label: 'lo' }, { box: 'rslider', outlet: 1, label: 'hi' }],
      at: [{ t: 0.4, act: (h) => typeInto(end(h, 0), 64) }, { t: 0.8, act: (h) => typeInto(end(h, 1), 64) }],
    });
    expect(firsts(r.heard.lo)).toEqual([64, 64]);
    expect(firsts(r.heard.hi)).toEqual([127, 64]);
    // until you drag: 220 and 330, a fifth apart
    expect(tone(r.left, 0.05, 0.35, 220)).toBeCloseTo(0.1, 2);
    expect(tone(r.left, 0.05, 0.35, 330)).toBeCloseTo(0.1, 2);
    // low end to the middle (about note 60), high end at the top (note 72): pulled apart
    expect(tone(r.left, 0.45, 0.75, mtof(60))).toBeGreaterThan(0.08);
    expect(tone(r.left, 0.45, 0.75, mtof(72))).toBeCloseTo(0.1, 2);
    // high end down to meet it: one note
    expect(pitch(r.left, 0.85, 1.15)).toBeCloseTo(mtof(60), -1);
    expect(tone(r.left, 0.85, 1.15, mtof(72))).toBeLessThan(0.01);      // the high note is gone
  });
});

describe('slider/0: Drag to change the pitch', () => {
  it('"A slider sends 0..127 as you drag it. scale maps that onto 200..1000 Hz for cycle~"', async () => {
    const r = await play('slider', 0, {
      seconds: 1.2,
      listen: [{ box: 'slider' }],
      at: [{ t: 0.4, act: (h) => typeInto(h.el<HTMLInputElement>('slider'), 127) }, { t: 0.8, act: (h) => typeInto(h.el<HTMLInputElement>('slider'), 0) }],
    });
    const s = r.h.el<HTMLInputElement>('slider');
    expect([s.min, s.max]).toEqual(['0', '127']);
    expect(firsts(r.heard.slider)).toEqual([127, 0]);
    expect(pitch(r.left, 0.05, 0.35)).toBeCloseTo(330, -1);
    expect(pitch(r.left, 0.45, 0.75)).toBeCloseTo(1000, -1);
    expect(pitch(r.left, 0.85, 1.15)).toBeCloseTo(200, -1);
  });
});

describe('tab/0: Tabs that pick an octave', () => {
  it('"sends its number (from 0) out the left outlet and its text out the middle one ... climbs an octave at a time, then drops back"', async () => {
    const r = await play('tab', 0, {
      seconds: 2.0,
      listen: [{ box: 'tab', outlet: 0, label: 'index' }, { box: 'tab', outlet: 1, label: 'text' }],
    });
    expect([...r.h.el('tab').children].map((b) => b.textContent)).toEqual(['low', 'mid', 'high']);
    expect(firsts(r.heard.index)).toEqual([0, 1, 2, 0]);
    expect(firsts(r.heard.text)).toEqual(['low', 'mid', 'high', 'low']);
    expect(pitch(r.left, 0.05, 0.45)).toBeCloseTo(220, -1);
    expect(pitch(r.left, 0.55, 0.95)).toBeCloseTo(440, -1);
    expect(pitch(r.left, 1.05, 1.45)).toBeCloseTo(880, -1);
    expect(pitch(r.left, 1.55, 1.95)).toBeCloseTo(220, -1);
  });
});

describe('toggle/0: Switch up an octave', () => {
  it('"clicking it sends 1, clicking again sends 0 ... MIDI note 57 or 69"', async () => {
    const r = await play('toggle', 0, {
      seconds: 1.0,
      listen: [{ box: 'toggle' }, { box: '+ 57' }],
      at: [{ t: 0.3, act: (h) => h.el('toggle').click() }, { t: 0.6, act: (h) => h.el('toggle').click() }],
    });
    expect(firsts(r.heard.toggle)).toEqual([1, 0]);
    expect(firsts(r.heard['+ 57'])).toEqual([69, 57]);
    expect(pitch(r.left, 0.05, 0.25)).toBeCloseTo(220, -1);
    expect(pitch(r.left, 0.35, 0.55)).toBeCloseTo(440, -1);
    expect(pitch(r.left, 0.65, 0.95)).toBeCloseTo(220, -1);
  });
});

describe('umenu/0: Choosing notes from a menu', () => {
  it('"its text, as a message, out the middle one ... the items 60, 64, 67 and 72 ... a C major arpeggio"', async () => {
    const r = await play('umenu', 0, {
      seconds: 1.5,
      listen: [{ box: 'umenu', outlet: 0, label: 'index' }, { box: 'umenu', outlet: 1, label: 'item' }],
    });
    expect([...r.h.el<HTMLSelectElement>('umenu').options].map((o) => o.textContent)).toEqual(['60', '64', '67', '72']);
    expect(firsts(r.heard.index)).toEqual([0, 1, 2, 3, 0]);
    expect(firsts(r.heard.item)).toEqual([60, 64, 67, 72, 60]);
    [60, 64, 67, 72, 60].forEach((n, i) => expect(pitch(r.left, i * 0.3 + 0.04, i * 0.3 + 0.27)).toBeCloseTo(mtof(n), -1));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MSP operators
// ════════════════════════════════════════════════════════════════════════════

describe('abs~/0: Fold a slow sine into swells', () => {
  it('"A 2 Hz sine ... folded by abs~, it swells four times a second"', async () => {
    const r = await play('abs~', 0, { seconds: 2.0 });
    expect(swells(r.left, 0, 2)).toBeCloseTo(4, 0);
    expect(peak(r.left)).toBeCloseTo(0.2, 2);
    // between swells it goes all the way down (|sin| touches 0), but never stays down
    const env = Array.from({ length: 200 }, (_, i) => rms(r.left, i * 0.01, i * 0.01 + 0.01));
    expect(Math.min(...env)).toBeLessThan(0.02);
    expect(Math.max(...env)).toBeGreaterThan(0.13);
  });
});

describe('clip~/0: Distortion by clipping', () => {
  it('"Boost a sine to 5 times its level, then clip~ cuts everything outside -0.3..0.3"', async () => {
    const r = await play('clip~', 0, { seconds: 0.5 });
    const s = seg(r.left, 0.05, 0.45);
    expect(peak(r.left, 0.05, 0.45)).toBeCloseTo(0.3 * 0.2, 4);
    const flat = s.filter((v) => Math.abs(Math.abs(v) - 0.06) < 1e-4).length / s.length;
    expect(flat).toBeGreaterThan(0.9);                                // |5 sin| > 0.3 for 96% of the time
    expect(pitch(r.left, 0.05, 0.45)).toBeCloseTo(196, -1);
    expect(tone(r.left, 0.05, 0.45, 3 * 196)).toBeGreaterThan(0.1 * tone(r.left, 0.05, 0.45, 196)); // gritty: odd harmonics
  });
});

describe('div~/0: Divide a pitch: the undertones', () => {
  it('"sig~ holds 880 and /~ divides it ... by 2 you hear 440 Hz"; dial at the top divides by 8', async () => {
    const r = await play('div~', 0, {
      seconds: 1.0,
      listen: [{ box: 'scale' }],
      at: [{ t: 0.5, act: (h) => typeInto(h.el<HTMLInputElement>('dial'), 127) }],
    });
    expect(pitch(r.left, 0.05, 0.45)).toBeCloseTo(440, -1);
    expect(firsts(r.heard.scale)).toEqual([8]);
    expect(pitch(r.left, 0.55, 0.95)).toBeCloseTo(110, -1);
  });
  // scale.maxref: "If only four arguments are provided and all four are of type int, scale
  // will output scaled values as integers" (truncated). So `scale 0 127 1 8` gives whole
  // divisors: dial 64 -> 1 + 64*7/127 = 4.53 -> 4 -> 220 Hz, an undertone. The engine's
  // scale (web/src/objects/control/index.ts, register('scale')) always outputs a float, so
  // the dial sweeps smoothly through non-undertone pitches (880/4.53 = 194 Hz).
  it.fails('BUG (engine): "whole numbers 1..8" -- dial 64 should divide by 4 (220 Hz), the engine divides by 4.53', async () => {
    const r = await play('div~', 0, {
      seconds: 0.8, listen: [{ box: 'scale' }],
      at: [{ t: 0.3, act: (h) => typeInto(h.el<HTMLInputElement>('dial'), 64) }],
    });
    expect(firsts(r.heard.scale)).toEqual([4]);
    expect(pitch(r.left, 0.35, 0.75)).toBeCloseTo(220, -1);
  });
});

describe('-~/0: Center a ramp around zero', () => {
  it('"-~ 0.5 subtracts that offset and leaves a sawtooth that swings evenly from -0.5 to 0.5"', async () => {
    const r = await play('-~', 0, { seconds: 1.0 });
    const s = seg(r.left, 0.1, 0.9);
    const mean = s.reduce((a, v) => a + v, 0) / s.length;
    expect(mean).toBeCloseTo(0, 3);
    expect(Math.max(...s)).toBeCloseTo(0.5 * 0.2, 2);
    expect(Math.min(...s)).toBeCloseTo(-0.5 * 0.2, 2);
    expect(crossingsPerSec(r.left, 0.1, 0.9)).toBeCloseTo(220, -1);   // 110 ramps a second, two crossings each
  });
});

describe('+~/0: Mixing two tones', () => {
  it('"adding two oscillators plays them together, a fifth apart"', async () => {
    const r = await play('+~', 0, { seconds: 1.0 });
    expect(tone(r.left, 0.1, 0.9, 220)).toBeCloseTo(0.15, 2);
    expect(tone(r.left, 0.1, 0.9, 330)).toBeCloseTo(0.15, 2);
    expect(330 / 220).toBe(1.5);
    expect(peak(r.left, 0.1, 0.9)).toBeLessThanOrEqual(0.3 + 1e-3);
  });
});

describe('+=~/0: A pitch that keeps rising', () => {
  it('"its sum grows by 88 every second (at 44.1 kHz), and that sum, plus 200, is cycle~\'s frequency"', async () => {
    const r = await play('+=~', 0, { seconds: 2.2 });
    const f = (t: number) => pitch(r.left, t - 0.03, t + 0.03);
    expect(0.002 * SR).toBeCloseTo(88.2, 5);
    near(f(0.5), 200 + 0.5 * 88.2);
    near(f(1.0), 200 + 88.2);
    near(f(2.0), 200 + 2 * 88.2);
  });
});

describe('pow~/0: Octaves into frequencies', () => {
  it('"a sweep from 110 to 440 Hz, two octaves, that rises evenly in pitch"', async () => {
    const r = await play('pow~', 0, { seconds: 2.3 });
    const f = (t: number) => pitch(r.left, t - 0.025, t + 0.025);
    // 110 * 2^(2 * 0.5t): t = 0.5, 1, 1.5, 1.95 -> 155.6, 220, 311.1, 427.0
    const ts = [0.5, 1.0, 1.5, 1.95];
    ts.forEach((t) => expect(f(t) / (110 * Math.pow(2, t))).toBeCloseTo(1, 1));
    const octaves = ts.map((t) => Math.log2(f(t) / 110));
    for (let i = 1; i < 3; i++) expect(octaves[i] - octaves[i - 1]).toBeCloseTo(0.5, 1);   // evenly: half an octave per 0.5 s
    expect(f(2.1)).toBeLessThan(130);                                  // and back to the bottom
  });
});

describe('rdiv~/0: A reciprocal siren', () => {
  const sweep = async () => {
    const r = await play('rdiv~', 0, { seconds: 4.0 });
    return Array.from({ length: 78 }, (_, i) => pitch(r.left, 0.05 + i * 0.05, 0.1 + i * 0.05));
  };
  it('"the pitch swings between 660 and 330 Hz"', async () => {
    const fs = await sweep();
    expect(Math.max(...fs)).toBeCloseTo(660, -1.5);
    expect(Math.min(...fs)).toBeCloseTo(330, -1);
  });
  // 330/x with x = 0.75 + 0.25 sin: near the top (x = 0.5) the pitch changes 4x faster
  // than near the bottom (x = 1), so it spends LESS time up high: above the middle pitch
  // (466.7 Hz, geometric mean) only 44.5% of the time, within 5% of 660 Hz 15% vs within
  // 5% of 330 Hz 20%. The text has it backwards.
  it.fails('BUG (text): "lingering longer up high" -- it spends more time low (44% of the time above the middle pitch)', async () => {
    const fs = await sweep();
    expect(fs.filter((f) => f > Math.sqrt(330 * 660)).length / fs.length).toBeGreaterThan(0.5);
  });
});

describe('rminus~/0: Turn a rising ramp into plucks', () => {
  it('"phasor~\'s rising ramp becomes a falling one ... a sharp attack and a fade, twice a second"', async () => {
    const r = await play('rminus~', 0, { seconds: 1.1 });
    expect(pitch(r.left, 0.0, 0.2)).toBeCloseTo(392, -1);
    for (const t0 of [0, 0.5]) {
      expect(rms(r.left, t0 + 0.005, t0 + 0.05)).toBeGreaterThan(0.12);   // starts near full (1 * 0.2)
      expect(rms(r.left, t0 + 0.2, t0 + 0.25)).toBeCloseTo((0.55 * 0.2) / Math.SQRT2, 2); // fading
      expect(rms(r.left, t0 + 0.45, t0 + 0.495)).toBeLessThan(0.015);  // nearly gone before the next
    }
  });
});

describe('round~/0: A stepped, crunchy sine', () => {
  const levels = (x: Float32Array, q: number) => {
    const s = seg(x, 0.05, 0.45);
    const on = s.filter((v) => Math.abs(v / q - Math.round(v / q)) < 1e-3);
    return { onGrid: on.length / s.length, n: new Set(on.map((v) => Math.round(v / q))).size };
  };
  it('"rounds every sample to the nearest quarter, so a smooth sine becomes a staircase of 9 levels"; the dial makes bigger steps', async () => {
    const r = await play('round~', 0, { seconds: 1.0, at: [{ t: 0.5, act: (h) => typeInto(h.el<HTMLInputElement>('dial'), 127) }] });
    const quarter = levels(r.left, 0.25 * 0.2);
    expect(quarter.n).toBe(9);
    expect(quarter.onGrid).toBeGreaterThan(0.97);
    const half = levels(r.left.subarray(Math.round(0.5 * SR)), 0.5 * 0.2);   // dial top: step 0.5
    expect(half.n).toBe(5);
    expect(half.onGrid).toBeGreaterThan(0.97);
  });
  // Max's round~ puts every sample exactly on a multiple. The engine's round~
  // (web/src/objects/audio/dynamics.ts, roundCurve) is a 2048-point WaveShaper table, which
  // Web Audio reads with linear interpolation, so samples landing near a step edge come out
  // between two levels.
  it.fails('BUG (engine): every sample should be on the staircase; a few fall between steps', async () => {
    const r = await play('round~', 0, { seconds: 0.5 });
    expect(levels(r.left, 0.25 * 0.2).onGrid).toBe(1);
  });
});

describe('sig~/0: A number as a signal', () => {
  it('"Here it sets cycle~\'s frequency to 262 Hz, middle C"', async () => {
    const r = await play('sig~', 0, { seconds: 0.5 });
    expect(tone(r.left, 0.05, 0.45, 262)).toBeCloseTo(0.2, 2);
    near(pitch(r.left, 0.05, 0.45), 262);
  });
});

describe('sqrt~/0: Equal-power panning', () => {
  it('"sqrt~ of p sets the right speaker and sqrt~ of 1 - p the left, so the tone glides across without dipping in the middle"', async () => {
    const r = await play('sqrt~', 0, { seconds: 4.0 });
    const L: number[] = [], R: number[] = [];
    for (let t = 0.05; t < 3.95; t += 0.05) { L.push(rms(r.left, t, t + 0.05)); R.push(rms(r.right, t, t + 0.05)); }
    const full = 0.2 / Math.SQRT2;
    L.forEach((l, i) => expect(Math.hypot(l, R[i]) / full).toBeCloseTo(1, 1));   // total power steady
    expect(Math.max(...L)).toBeGreaterThan(0.97 * full);                        // all the way left ...
    expect(Math.max(...R)).toBeGreaterThan(0.97 * full);                        // ... and all the way right
    const mid = L.findIndex((l, i) => i > 0 && Math.sign(l - R[i]) !== Math.sign(L[i - 1] - R[i - 1]));
    expect(L[mid] / full).toBeCloseTo(Math.SQRT1_2, 1);                          // in the middle each side is 0.707
  });
});

describe('*~/0: Volume', () => {
  it('"Its argument is the amount: 0.2 is a fifth of the level"', async () => {
    const r = await play('*~', 0, { seconds: 0.5 });
    expect(rms(r.left, 0.05, 0.45)).toBeCloseTo(0.2 / Math.SQRT2, 3);
    expect(peak(r.left)).toBeCloseTo(0.2, 3);
    expect(pitch(r.left, 0.05, 0.45)).toBeCloseTo(330, -1);
  });
});

describe('*~/1: Tremolo: audio times audio', () => {
  it('"A 4 Hz cycle~ goes into *~\'s right inlet; it swings -1..1, so you hear 8 pulses a second"', async () => {
    const r = await play('*~', 1, { seconds: 2.0 });
    expect(swells(r.left, 0, 2)).toBeCloseTo(8, 0);
    expect(peak(r.left)).toBeCloseTo(0.2, 2);
    // swinging -1..1 means a 330 Hz tone times a 4 Hz sine: sidebands at 326 and 334 Hz, no 330 left
    expect(tone(r.left, 0.05, 1.95, 326)).toBeCloseTo(0.1, 2);
    expect(tone(r.left, 0.05, 1.95, 334)).toBeCloseTo(0.1, 2);
    expect(tone(r.left, 0.05, 1.95, 330)).toBeLessThan(0.01);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// MIDI
// ════════════════════════════════════════════════════════════════════════════

describe('bendin/0: The pitch-bend wheel', () => {
  it('"until then it holds middle C" (no device: bendin sends nothing)', async () => {
    const r = await play('bendin', 0, { seconds: 0.6, listen: [{ box: 'bendin' }] });
    expect(r.heard.bendin).toEqual([]);
    expect(pitch(r.left, 0.05, 0.55)).toBeCloseTo(262, -1);
  });
  it('"0 to 127 with 64 in the middle. Minus 64, divided by 32, that\'s up to 2 semitones either way around note 60"', async () => {
    const r = await play('bendin', 0, {
      seconds: 1.3, listen: [{ box: '+ 60.0' }],
      at: [{ t: 0.3, act: (h) => h.send('bendin', 0, [127, 1]) }, { t: 0.65, act: (h) => h.send('bendin', 0, [0, 1]) }, { t: 1.0, act: (h) => h.send('bendin', 0, [64, 1]) }],
    });
    expect(firsts(r.heard['+ 60.0'])).toEqual([60 + 63 / 32, 58, 60]);
    near(pitch(r.left, 0.35, 0.6), mtof(60 + 63 / 32));
    near(pitch(r.left, 0.7, 0.95), mtof(58));
    near(pitch(r.left, 1.05, 1.25), mtof(60));
  });
  // bendin.maxref: "If a specific channel number is included in the argument, there is only
  // one outlet." maxpylang writes `bendin a 1` with numoutlets 2.
  it.fails('BUG (maxpylang): "bendin a 1" has one outlet in Max, the box says 2', () => {
    expect(box('bendin', 0, 'bendin').numoutlets).toBe(1);
  });
});

describe('ctlin/0: A knob on your controller', () => {
  it('"until then lores~ holds it at 600 Hz"; a knob\'s value (0 to 127) opens and closes the filter', async () => {
    const r = await play('ctlin', 0, {
      seconds: 1.5, listen: [{ box: 'ctlin' }, { box: 'scale' }],
      at: [{ t: 0.5, act: (h) => h.send('ctlin', 0, [1, 127, 1]) }, { t: 1.0, act: (h) => h.send('ctlin', 0, [1, 0, 1]) }],
    });
    expect(firsts(r.heard.ctlin)).toEqual([127, 0]);                  // the value is the left outlet
    expect(firsts(r.heard.scale)).toEqual([4000, 200]);
    const b600 = brightness(r.left, 0.05, 0.45, 110);
    expect(brightness(r.left, 0.55, 0.95, 110)).toBeGreaterThan(5 * b600);
    expect(brightness(r.left, 1.05, 1.45, 110)).toBeLessThan(b600 / 5);
  });
  it('without a device nothing comes out of ctlin', async () => {
    const r = await play('ctlin', 0, { seconds: 0.4, listen: [{ box: 'ctlin' }] });
    expect(r.heard.ctlin).toEqual([]);
  });
});

describe('flush/0: Let go of every held note', () => {
  const go = () => play('flush', 0, { seconds: 3.0, listen: [{ box: 'flush', outlet: 1, label: 'vel' }, { box: 'flush', outlet: 0, label: 'pitch' }] });
  it('"every 2.25 seconds a bang makes flush send a note-off (velocity 0) for each, and the tone drops out until the next note"', async () => {
    const r = await go();
    const offs = (t: number) => r.heard.pitch.filter((x, i) => Math.abs(x.t - t) < 0.015 && r.heard.vel[i].msg[0] === 0);
    // a note-off for every note held since the last flush (61..64; see the next test for 60)
    expect(firsts(offs(2.25))).toEqual([61, 62, 63, 64]);
    expect(rms(r.left, 0.6, 2.2)).toBeGreaterThan(0.1);                          // these never stopped
    expect(rms(r.left, 2.27, 2.49)).toBeLessThan(1e-3);                          // drops out ...
    expect(rms(r.left, 2.52, 2.9)).toBeCloseTo(((100 / 127) * 0.2) / Math.SQRT2, 2); // ... until the next note
  });
  // Both metros start at load, so the first 2.25 s flush lands at time 0, in the same
  // instant as the first note. In the engine the note goes first and is flushed at once:
  // the first half second is silent (and every 4.5 s the same collision recurs). In Max the
  // order of two metros started together is not something to rely on. Suggested fix: start
  // the release metro after the first note, e.g. a `delay 2250` from loadbang into a
  // `metro 2250`, or give the flush clock `@active 0` and start it 10 ms later.
  it.fails('BUG (example): "the tone never stops" -- the flush at time 0 silences the first note (0-0.5 s)', async () => {
    const r = await go();
    expect(r.heard.vel.slice(0, 2).map((x) => x.msg[0])).toEqual([100, 100]);
    expect(rms(r.left, 0.05, 0.45)).toBeGreaterThan(0.1);
  });
});

describe('makenote/0: Notes with a length', () => {
  const go = () => play('makenote', 0, { seconds: 2.0, listen: [{ box: 'makenote', outlet: 1, label: 'vel' }, { box: 'makenote', outlet: 0, label: 'pitch' }] });
  it('"pairs each pitch with a velocity (100) and sends a matching note-off (velocity 0) 200 ms later"', async () => {
    const r = await go();
    const v = r.heard.vel;
    expect(firsts(v).slice(0, 8)).toEqual([100, 0, 100, 0, 100, 0, 100, 0]);
    for (let i = 0; i + 1 < v.length; i += 2) expect(v[i + 1].t - v[i].t).toBeCloseTo(0.2, 1);
    const p = firsts(r.heard.pitch);
    for (let i = 0; i + 1 < p.length; i += 2) expect(p[i + 1]).toBe(p[i]);        // the note-off is for the same pitch
    near(pitch(r.left, 0.1, 0.19), mtof(p[0] as number));
    expect(rms(r.left, 0.37, 0.399)).toBeLessThan(1e-3);                         // released (150 ms) before the next
  });
  // adsr~.maxref: "A non-zero number triggers an envelope with the given amplitude" and the
  // sustain level is "a factor of the amplitude". So velocity 100/127 = 0.787 should be the
  // peak, and the sustain 0.6 * 0.787 * 0.2 = 0.094. The engine's adsr~
  // (web/src/objects/audio/env.ts, gate) always ramps to 1, ignoring the value.
  it.fails('BUG (engine): "the velocity drives adsr~" -- the sustain level should be 0.6 x 100/127', async () => {
    const r = await go();
    expect(peak(r.left, 0.1, 0.19)).toBeCloseTo(0.6 * (100 / 127) * 0.2, 2);
  });
});

describe('midiformat/0: Write raw MIDI', () => {
  it('"its third inlet makes control changes from controller value ... sweeps controller 74 from 0 to 127, and midiparse reads it back to open the filter"', async () => {
    const r = await play('midiformat', 0, {
      seconds: 2.6,
      listen: [{ box: 'counter' }, { box: 'midiparse', outlet: 2, label: 'cc' }, { box: 'unpack', outlet: 1, label: 'value' }],
    });
    const n = r.heard.counter.length;
    expect(firsts(r.heard.counter).slice(0, 3)).toEqual([0, 1, 2]);
    expect(r.heard.cc.slice(0, 3).map((x) => x.msg)).toEqual([[74, 0], [74, 1], [74, 2]]);
    expect(firsts(r.heard.value)).toEqual(firsts(r.heard.counter).slice(0, n));
    expect(Math.max(...(firsts(r.heard.value) as number[]))).toBe(127);
    expect(brightness(r.left, 2.2, 2.5, 110)).toBeGreaterThan(5 * brightness(r.left, 0.1, 0.4, 110));  // the filter opens
  });
  // midiformat.maxref: the message is "sent out the outlet as individual bytes". The engine's
  // midiformat (web/src/objects/control/midi.ts) sends one list [176 74 v]; its midiparse
  // only reads such lists, so a byte stream from Max-style sources would not parse.
  it.fails('BUG (engine): midiformat sends the three bytes one at a time, as Max does', async () => {
    const r = await play('midiformat', 0, { seconds: 0.05, listen: [{ box: 'midiformat' }] });
    expect(r.heard.midiformat.slice(0, 3).map((x) => x.msg)).toEqual([[176], [74], [0]]);
  });
});

describe('midiparse/0: Read raw MIDI', () => {
  it('"notes come out its left outlet as pitch velocity ... unpack takes the pitch for the oscillator"', async () => {
    const r = await play('midiparse', 0, { seconds: 1.3, listen: [{ box: '+ 60' }, { box: 'midiparse', outlet: 0, label: 'note' }, { box: 'midiformat' }] });
    const notes = firsts(r.heard['+ 60']) as number[];
    expect(notes.length).toBe(6);
    expect(notes.every((n) => n >= 60 && n < 72)).toBe(true);           // random 12, + 60
    expect(new Set(notes).size).toBeGreaterThan(1);
    expect(r.heard.midiformat[0].msg[0]).toBe(144);                     // note-on status byte, channel 1
    expect(r.heard.note.map((x) => x.msg)).toEqual(notes.map((n) => [n, 100]));
    notes.slice(0, 5).forEach((n, i) => near(pitch(r.left, i * 0.25 + 0.03, i * 0.25 + 0.22), mtof(n)));
  });
});

describe('notein/0: Notes from a MIDI keyboard', () => {
  it('"until then cycle~ holds its 262 Hz (middle C) at a fixed level"', async () => {
    const r = await play('notein', 0, { seconds: 0.6, listen: [{ box: 'notein' }] });
    expect(r.heard.notein).toEqual([]);
    expect(pitch(r.left, 0.05, 0.55)).toBeCloseTo(262, -1);
    expect(rms(r.left, 0.05, 0.55)).toBeCloseTo((0.5 * 0.2) / Math.SQRT2, 3);
  });
  it('"outputs the pitch and velocity of each key you play ... to change the pitch and loudness"', async () => {
    const r = await play('notein', 0, {
      seconds: 1.0, at: [{ t: 0.3, act: (h) => h.send('notein', 0, [64, 127, 1]) }, { t: 0.65, act: (h) => h.send('notein', 0, [64, 0, 1]) }],
    });
    near(pitch(r.left, 0.35, 0.6), mtof(64));
    expect(rms(r.left, 0.35, 0.6)).toBeCloseTo(0.2 / Math.SQRT2, 3);
    expect(rms(r.left, 0.7, 0.95)).toBeLessThan(1e-4);                  // let go: velocity 0
  });
});

describe('pgmin/0: Program changes pick the note', () => {
  it('"until then cycle~ holds middle C"; a program number, % 12 plus 60, becomes a note', async () => {
    const r = await play('pgmin', 0, {
      seconds: 1.0, listen: [{ box: 'pgmin' }, { box: '+ 60' }],
      at: [{ t: 0.5, act: (h) => h.send('pgmin', 0, [17, 1]) }],
    });
    expect(firsts(r.heard.pgmin)).toEqual([17]);
    expect(pitch(r.left, 0.05, 0.45)).toBeCloseTo(262, -1);
    expect(firsts(r.heard['+ 60'])).toEqual([65]);
    near(pitch(r.left, 0.55, 0.95), mtof(65));
  });
  // pgmin.maxref: "If a specific channel number is included in the argument, there is only
  // one outlet." maxpylang writes `pgmin a 1` with numoutlets 2.
  it.fails('BUG (maxpylang): "pgmin a 1" has one outlet in Max, the box says 2', () => {
    expect(box('pgmin', 0, 'pgmin').numoutlets).toBe(1);
  });
});

describe('stripnote/0: Drop the note-offs', () => {
  it('"decide gives each step velocity 100 or 0 (a note-off), so only some steps of the scale pluck; the rest are rests"', async () => {
    const r = await play('stripnote', 0, {
      seconds: 2.0,
      listen: [{ box: '* 100' }, { box: 'counter' }, { box: 'stripnote', outlet: 0, label: 'on' }],
    });
    const vel = firsts(r.heard['* 100']);
    expect(vel.length).toBe(10);
    expect(vel.every((v) => v === 0 || v === 100)).toBe(true);
    expect(vel).toContain(0);
    expect(vel).toContain(100);
    const steps = r.heard.counter;
    expect(firsts(steps).slice(0, 8)).toEqual([60, 61, 62, 63, 64, 65, 66, 67]);
    expect(firsts(r.heard.on)).toEqual(firsts(steps).filter((_, i) => vel[i] === 100));
    steps.forEach((s, i) => {
      const loud = rms(r.left, s.t + 0.01, s.t + 0.12);
      if (vel[i] === 100) {
        expect(loud).toBeGreaterThan(0.03);
        near(pitch(r.left, s.t + 0.005, s.t + 0.15), mtof(s.msg[0] as number));
      } else expect(loud).toBeLessThan(1e-3);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Distortion, dynamics, output
// ════════════════════════════════════════════════════════════════════════════

describe('degrade~/0: Lo-fi: fewer bits', () => {
  it('"0.2 of the rate and 4 bits"', async () => {
    const r = await play('degrade~', 0, { seconds: 0.5 });
    const s = Array.from(seg(r.left, 0.05, 0.45), (v) => v / 0.2);
    expect(new Set(s.map((v) => v.toFixed(5))).size).toBeLessThanOrEqual(16);   // 2^4 levels
    s.forEach((v) => expect(Math.abs(v * 8 - Math.round(v * 8))).toBeLessThan(1e-4));  // multiples of 1/8
    const changes: number[] = [];
    for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) changes.push(i);
    for (let k = 1; k < changes.length; k++) expect((changes[k] - changes[0]) % 5).toBe(0);  // held 5 samples (1 / 0.2)
    expect(pitch(r.left, 0.05, 0.45)).toBeCloseTo(330, -1);
  });
});

describe('gate~/0: Chop a drone', () => {
  it('"passes the signal in its right inlet while its left inlet is 1 and outputs silence at 0 ... every 250 ms"', async () => {
    const r = await play('gate~', 0, { seconds: 1.3, listen: [{ box: 'counter' }] });
    expect(firsts(r.heard.counter)).toEqual([0, 1, 0, 1, 0, 1]);
    for (let k = 0; k < 5; k++) {
      const level = rms(r.left, k * 0.25 + 0.02, k * 0.25 + 0.23);
      if (k % 2) expect(level).toBeGreaterThan(0.02);
      else expect(level).toBeLessThan(1e-4);
    }
    expect(pitch(r.left, 0.27, 0.48)).toBeCloseTo(110, -1);
  });
});

describe('limi~/0: A swell held under the ceiling', () => {
  const go = async () => {
    const r = await play('limi~', 0, { seconds: 4.0 });
    const out = Float32Array.from(r.left, (v) => v / 0.2);           // limi~'s own output
    const env = Array.from({ length: 39 }, (_, i) => peak(out, 0.05 + i * 0.1, 0.15 + i * 0.1));
    return { out, env };
  };
  it('"limi~ ... turns the peaks down, so the swell flattens out at the top instead of distorting"', async () => {
    const { out, env } = await go();
    const top = env.filter((p) => p > 0.95);
    expect(top.length).toBeGreaterThan(10);                          // a long flat top ...
    expect(Math.max(...top) - Math.min(...top)).toBeLessThan(0.1);   // ... where the input goes 1.5 -> 3 -> 1.5
    const loud = env.indexOf(Math.max(...env)) * 0.1 + 0.05;
    expect(tone(out, loud, loud + 0.1, 660) / tone(out, loud, loud + 0.1, 220)).toBeLessThan(0.03); // not distorting
  });
  // limi~ is a lookahead peak limiter: nothing above its threshold (0 dB by default) gets
  // out. The engine's limi~ (web/src/objects/audio/dynamics.ts) is a DynamicsCompressorNode
  // (threshold -1 dB, ratio 20, plus Web Audio's automatic make-up gain), which lets the
  // peaks through at up to 1.056 (+0.5 dB) -- the clipping the text says is avoided.
  it.fails('BUG (engine): the output should never pass full scale (1.0); the engine\'s peaks reach 1.056', async () => {
    const { out } = await go();
    expect(peak(out, 0.05, 4)).toBeLessThanOrEqual(1.0);
  });
});

describe('overdrive~/0: Warm distortion', () => {
  it('"its argument is the drive (1 is clean). A 110 Hz sine driven to 6 sounds buzzy and full"; "drag the number box to change the drive"', async () => {
    const r = await play('overdrive~', 0, { seconds: 1.0, at: [{ t: 0.5, act: (h) => typeInto(h.el<HTMLInputElement>('number'), 1) }] });
    const h3 = (t0: number) => tone(r.left, t0, t0 + 0.4, 330) / tone(r.left, t0, t0 + 0.4, 110);
    expect(h3(0.05)).toBeGreaterThan(0.1);                          // drive 6: strong 3rd harmonic
    expect(rms(r.left, 0.05, 0.45) / peak(r.left, 0.05, 0.45)).toBeGreaterThan(0.8);  // fuller than a sine's 0.707
    expect(h3(0.55)).toBeLessThan(0.01);                             // drive 1: clean
    expect(peak(r.left, 0.55, 0.95)).toBeCloseTo(0.2, 2);
  });
});

describe('pong~/0: A wavefolder', () => {
  it('"folds a signal back whenever it goes past its limits (-1 and 1) ... A slow LFO changes how loud it goes in, so the tone opens and closes"', async () => {
    const r = await play('pong~', 0, { seconds: 3.4 });
    expect(peak(r.left, 0.05, 3.4)).toBeLessThanOrEqual(0.2 + 1e-4);    // always inside -1..1
    const rates = Array.from({ length: 33 }, (_, i) => crossingsPerSec(r.left, 0.05 + i * 0.1, 0.15 + i * 0.1));
    expect(Math.min(...rates)).toBeCloseTo(220, -1);                    // gain 1: a plain 110 Hz sine
    expect(Math.max(...rates)).toBeGreaterThan(3 * 220);                // gain 5: folded many times
    expect(pitch(r.left, 0.05, 0.25)).toBeCloseTo(110, -1);             // still 110 Hz underneath
  });
});

describe('tanh~/0: Soft saturation', () => {
  it('"quiet parts pass almost unchanged, loud parts round off ... A sine boosted 4 times comes out warm and slightly square"', async () => {
    const r = await play('tanh~', 0, { seconds: 1.0, listen: [{ box: 'number' }], at: [{ t: 0.5, act: (h) => typeInto(h.el<HTMLInputElement>('number'), 1) }] });
    expect(peak(r.left, 0.05, 0.45)).toBeCloseTo(Math.tanh(4) * 0.2, 3);
    expect(rms(r.left, 0.05, 0.45) / peak(r.left, 0.05, 0.45)).toBeGreaterThan(0.85);    // squarer than a sine
    expect(tone(r.left, 0.05, 0.45, 441) / tone(r.left, 0.05, 0.45, 147)).toBeGreaterThan(0.1);
    // number box 1 (an int box: 1 is the smallest boost it can give): much less rounding
    expect(firsts(r.heard.number)).toEqual([1]);
    expect(peak(r.left, 0.55, 0.95)).toBeCloseTo(Math.tanh(1) * 0.2, 3);
    const h3 = (t0: number) => tone(r.left, t0, t0 + 0.4, 441) / tone(r.left, t0, t0 + 0.4, 147);
    expect(h3(0.55)).toBeLessThan(h3(0.05) / 3);
  });
});

describe('ezdac~/0: Different sounds left and right', () => {
  it('"left inlet is the left speaker and its right inlet the right one. 220 Hz left and 223 Hz right beat against each other three times a second"', async () => {
    const r = await play('ezdac~', 0, { seconds: 2.1 });
    expect(tone(r.left, 0.05, 2.05, 220)).toBeCloseTo(0.2, 2);
    expect(tone(r.left, 0.05, 2.05, 223)).toBeLessThan(0.01);
    expect(tone(r.right, 0.05, 2.05, 223)).toBeCloseTo(0.2, 2);
    expect(tone(r.right, 0.05, 2.05, 220)).toBeLessThan(0.01);
    const mix = Float32Array.from(r.left, (v, i) => v + r.right[i]);
    expect(swells(mix, 0.05, 2.05)).toBeCloseTo(3, 0);
  });
});

describe('gain~/0: A fader for signals', () => {
  // gain~.maxref: "128 is full scale ... A change of 10 in the slider produces a 6 dB change"
  // (increment 1.071519 per step), and an int in the left inlet "Sets the value of the
  // slider, ramps the output signal to the level ... and outputs the slider's value out the
  // right outlet". 120 is 8 steps below 128: 1.071519^-8 = 0.576 (-4.8 dB).
  it('"loadbang sets it to 120" (the message box sends 120 at load)', async () => {
    const r = await play('gain~', 0, { seconds: 0.3, listen: [{ box: ' 120' }] });
    expect(firsts(r.heard[' 120'])).toEqual([120]);
  });
  it.fails('BUG (engine): gain~ ignores the 120 and passes the saw at full level (Max: x0.576, -4.8 dB) and sends nothing from its right outlet', async () => {
    const r = await play('gain~', 0, { seconds: 0.6, listen: [{ box: 'gain~', outlet: 1, label: 'value' }] });
    const sawRms = 0.2 / Math.sqrt(3);
    expect(rms(r.left, 0.1, 0.55) / sawRms).toBeCloseTo(Math.pow(1.071519, -8), 1);
    expect(firsts(r.heard.value)).toEqual([120]);
  });
});

