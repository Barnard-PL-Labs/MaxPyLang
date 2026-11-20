// Claims audit, group 6: data objects, dictionaries, conversions, comparisons, Jitter, random.
// Every test quotes the example text it holds the example to. Real bugs are kept as
// it.fails('BUG: ...') so the suite stays green while documenting them.
import { describe, expect, it } from 'vitest';
import { run as render, runVideo, pitch, rms, firsts, testPicture, SR, type Heard } from './helpers/measure';

/** The helper schedules a suspend on every 10 ms step; a length just past a 128-frame block
 * boundary keeps the last one inside the render (otherwise an unhandled rejection). */
const run: typeof render = (object, index, opts = {}) =>
  render(object, index, { ...opts, seconds: ((Math.floor(((opts.seconds ?? 2.5) * SR) / 128) + 0.25) * 128) / SR });

const mtof = (n: number) => 440 * 2 ** ((n - 69) / 12);
const nums = (h: Heard[]) => firsts(h) as number[];
/** Steady-state pitch during the message h[i] (period `p` s). */
const pitchAt = (x: Float32Array, h: Heard[], i: number, p: number) => pitch(x, h[i].t + 0.03, h[i].t + p - 0.02);
const rmsAt = (x: Float32Array, h: Heard[], i: number, p: number) => rms(x, h[i].t + 0.03, h[i].t + p - 0.02);
const frac = (xs: number[], v: number) => xs.filter((x) => x === v).length / xs.length;

// ── Data ─────────────────────────────────────────────────────────────────────

describe('anal/0: Count how often a step repeats', () => {
  it('"each pair of numbers in a row, with how many times that pair has come so far: previous current count"', async () => {
    const r = await run('anal', 0, { seconds: 3.3, listen: [{ box: 'counter' }, { box: 'anal' }, { box: 'zl.nth' }, { box: '+ 58' }] });
    const steps = nums(r.heard.counter);
    expect(steps.slice(0, 8)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    // Max: "The first time a number is received ... nothing happens" -> one message fewer.
    expect(r.heard.anal.length).toBe(steps.length - 1);
    const seen = new Map<string, number>();
    r.heard.anal.forEach((h, i) => {
      const k = `${steps[i]},${steps[i + 1]}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      expect(h.msg).toEqual([steps[i], steps[i + 1], seen.get(k)]);
    });
    expect(nums(r.heard['zl.nth'])).toEqual(r.heard.anal.map((h) => h.msg[2]));
  });
  it('"the count, played as pitch, climbs a step each round"', async () => {
    const r = await run('anal', 0, { seconds: 3.3, listen: [{ box: '+ 58' }] });
    const notes = nums(r.heard['+ 58']);
    // round 1: pairs 0-1 1-2 2-3 seen once -> 60; from round 2 every pair -> 62, 64 ...
    expect(notes.slice(0, 3)).toEqual([60, 60, 60]);
    expect(notes.slice(3, 7)).toEqual([60, 62, 62, 62]); // 3-0 first seen once, then 2nd round
    expect(notes.slice(7, 11)).toEqual([62, 64, 64, 64]);
    expect(pitchAt(r.left, r.heard['+ 58'], 0, 0.2)).toBeCloseTo(mtof(60), -1);
    expect(pitchAt(r.left, r.heard['+ 58'], 8, 0.2)).toBeCloseTo(mtof(64), -1);
  });
});

describe('atoi/0: Play a word', () => {
  it('"hello" becomes 104 101 108 108 111. Less 36 ... zl.nth plays them in turn', async () => {
    const r = await run('atoi', 0, { seconds: 1.4, listen: [{ box: 'atoi' }, { box: 'zl.nth' }, { box: '- 36' }] });
    expect(r.heard.atoi[0].msg).toEqual([104, 101, 108, 108, 111]);
    expect(nums(r.heard['zl.nth']).slice(0, 5)).toEqual([104, 101, 108, 108, 111]);
    expect(nums(r.heard['- 36']).slice(0, 5)).toEqual([68, 65, 72, 72, 75]);
    expect(pitchAt(r.left, r.heard['- 36'], 0, 0.25)).toBeCloseTo(mtof(68), -1);
    expect(pitchAt(r.left, r.heard['- 36'], 4, 0.25)).toBeCloseTo(mtof(75), -1);
  });
});

describe('bag/0: A bag of notes', () => {
  it('"a bang sends them all out ... into zl.queue, which plays one per beat"', async () => {
    const r = await run('bag', 0, { seconds: 2.1, listen: [{ box: 'bag' }, { box: 'zl.queue' }, { box: 'counter' }] });
    expect(r.heard['zl.queue'].length).toBe(r.heard.counter.length); // one per beat
    expect([...nums(r.heard.bag).slice(0, 4)].sort()).toEqual([62, 65, 69, 72]);
    expect(nums(r.heard['zl.queue']).slice(0, 8)).toEqual([...nums(r.heard.bag).slice(0, 4), ...nums(r.heard.bag).slice(0, 4)]);
  });
  it.fails('BUG: engine bag dumps oldest-first; Max sends them "in reverse order from that in which they were stored" (72 69 65 62)', async () => {
    const r = await run('bag', 0, { seconds: 0.5, listen: [{ box: 'bag' }] });
    expect(nums(r.heard.bag).slice(0, 4)).toEqual([72, 69, 65, 62]);
  });
  it.fails('BUG (example text): "the bag empties its four notes" - a bang outputs the bag but keeps it (Max and engine); the second bar dumps them again', async () => {
    const r = await run('bag', 0, { seconds: 1.1, listen: [{ box: 'bag' }] });
    expect(r.heard.bag.length).toBe(4); // would be 4 if the bang emptied the bag; it is 8
  });
});

describe('coll/0: Step through a stored melody', () => {
  it('"next sends out the next one, going back to the first after the last"', async () => {
    const r = await run('coll', 0, { seconds: 2.6, listen: [{ box: 'listfunnel' }, { box: 'coll' }, { box: 'coll', outlet: 1, label: 'addr' }] });
    expect(r.heard.listfunnel.map((h) => h.msg)).toEqual([[0, 67], [1, 64], [2, 60], [3, 64], [4, 67], [5, 72], [6, 71], [7, 67]]);
    const tune = [67, 64, 60, 64, 67, 72, 71, 67];
    expect(nums(r.heard.coll).slice(0, 10)).toEqual([...tune, 67, 64]);
    expect(nums(r.heard.addr).slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]); // Max: next "Sends the address and data"
    expect(pitchAt(r.left, r.heard.coll, 2, 0.25)).toBeCloseTo(mtof(60), -1);
  });
});

describe('dict/0: A dictionary as a memory', () => {
  it('"dict answers "low 220" or "high 330" from its second outlet ... the tone swaps between 220 and 330 Hz"', async () => {
    const r = await run('dict', 0, { seconds: 2.1, listen: [{ box: 'dict', outlet: 1 }, { box: 'route' }, { box: 'route', outlet: 1, label: 'high' }] });
    expect(r.heard.dict.slice(0, 4).map((h) => h.msg)).toEqual([['low', 220], ['high', 330], ['low', 220], ['high', 330]]);
    expect(nums(r.heard.route)[0]).toBe(220);
    expect(nums(r.heard.high)[0]).toBe(330);
    expect(pitchAt(r.left, r.heard.dict, 0, 0.5)).toBeCloseTo(220, -1);
    expect(pitchAt(r.left, r.heard.dict, 1, 0.5)).toBeCloseTo(330, -1);
  });
});

describe('dict.deserialize/0: Text into a dictionary', () => {
  it('"The counter steps 4 to 8; times 55 that is 220 to 440 Hz ... dict.unpack takes freq back out"', async () => {
    const r = await run('dict.deserialize', 0, { seconds: 1.6, listen: [{ box: ' freq: $1' }, { box: 'dict.unpack' }] });
    expect(r.heard[' freq: $1'][0].msg).toEqual(['freq:', 220]);
    expect(nums(r.heard['dict.unpack']).slice(0, 5)).toEqual([220, 275, 330, 385, 440]);
    expect(pitchAt(r.left, r.heard['dict.unpack'], 0, 0.3)).toBeCloseTo(220, -1);
    expect(pitchAt(r.left, r.heard['dict.unpack'], 4, 0.3)).toBeCloseTo(440, -1);
  });
});

describe('dict.iter/0: A chord from a dictionary', () => {
  it('"sends its entries out one at a time as key value lists ... C major chord change to an F major chord"', async () => {
    const r = await run('dict.iter', 0, { seconds: 1.5, listen: [{ box: 'dict.iter' }, { box: 'mtof', label: 'a' }, { box: 'mtof', nth: 1, label: 'b' }, { box: 'mtof', nth: 2, label: 'c' }, { box: 'route', label: 'r0' }, { box: 'route', outlet: 1, label: 'r1' }, { box: 'route', outlet: 2, label: 'r2' }] });
    expect(r.heard['dict.iter'].slice(0, 6).map((h) => h.msg)).toEqual([['root', 60], ['third', 64], ['fifth', 67], ['root', 65], ['third', 69], ['fifth', 72]]);
    expect(nums(r.heard.r0)).toEqual([60, 65]);
    expect(nums(r.heard.r1)).toEqual([64, 69]);
    expect(nums(r.heard.r2)).toEqual([67, 72]);
    expect(nums(r.heard.a)[0]).toBeCloseTo(mtof(60), 3);
    expect(rms(r.left, 0.1, 0.9)).toBeCloseTo(0.1 * Math.sqrt(3 / 2), 2); // three sines of 0.1
  });
});

describe('dict.join/0: Adding keys to a dictionary', () => {
  it('"after dict.join it holds amp as well, and dict.unpack sets both the pitch and the level"', async () => {
    const r = await run('dict.join', 0, { seconds: 1.0, listen: [{ box: 'dict.unpack' }, { box: 'dict.unpack', outlet: 1, label: 'amp' }] });
    expect(nums(r.heard['dict.unpack']).slice(0, 3)).toEqual([220, 275, 330]);
    expect(nums(r.heard.amp)[0]).toBe(0.15);
    expect(pitchAt(r.left, r.heard['dict.unpack'], 0, 0.3)).toBeCloseTo(220, -1);
    expect(rmsAt(r.left, r.heard['dict.unpack'], 0, 0.3)).toBeCloseTo(0.15 / Math.SQRT2, 2);
  });
});

describe('dict.pack/0: Packing values into a dictionary', () => {
  it('"amp keeps its default of 0.2 ... a rising scale of eight notes, over and over"', async () => {
    const r = await run('dict.pack', 0, { seconds: 2.6, listen: [{ box: 'dict.unpack' }, { box: 'dict.unpack', outlet: 1, label: 'amp' }] });
    const f = nums(r.heard['dict.unpack']);
    for (let i = 0; i < 10; i++) expect(f[i]).toBeCloseTo(mtof(60 + (i % 8)), 3);
    expect(new Set(nums(r.heard.amp))).toEqual(new Set([0.2]));
    expect(rmsAt(r.left, r.heard['dict.unpack'], 1, 0.25)).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(pitchAt(r.left, r.heard['dict.unpack'], 7, 0.25)).toBeCloseTo(mtof(67), -1);
  });
});

describe('dict.route/0: Sorting dictionaries', () => {
  it('"The ones that match leave by the left outlet and play in your left ear; the others ... right ear"', async () => {
    const r = await run('dict.route', 0, { seconds: 1.3, listen: [{ box: 'dict.unpack', label: 'L' }, { box: 'dict.unpack', nth: 1, label: 'R' }] });
    expect(nums(r.heard.L)).toEqual([262, 392, 262].slice(0, r.heard.L.length));
    expect(nums(r.heard.R).slice(0, 2)).toEqual([330, 523]);
    expect(pitch(r.left, 0.05, 0.28)).toBeCloseTo(262, -1);
    expect(pitch(r.right, 0.35, 0.58)).toBeCloseTo(330, -1);
    expect(pitch(r.left, 0.65, 0.88)).toBeCloseTo(392, -1);
    expect(pitch(r.right, 0.95, 1.18)).toBeCloseTo(523, -1);
  });
});

describe('dict.serialize/0: A dictionary as text, and back', () => {
  it('"dict.serialize writes a dictionary out as dictionary syntax, freq : 330 ... the frequency that comes out the far end plays"', async () => {
    const r = await run('dict.serialize', 0, { seconds: 1.6, listen: [{ box: 'dict.serialize' }, { box: 'dict.unpack' }] });
    expect(r.heard['dict.serialize'][2].msg.join(' ')).toBe('freq : 330');
    expect(nums(r.heard['dict.unpack']).slice(0, 5)).toEqual([220, 275, 330, 385, 440]);
    expect(pitchAt(r.left, r.heard['dict.unpack'], 2, 0.3)).toBeCloseTo(330, -1);
  });
});

describe('dict.strip/0: Taking a key out of a dictionary', () => {
  it('"the removed key and its value go out the right outlet, and the dictionary without it out the left"', async () => {
    const r = await run('dict.strip', 0, { seconds: 1.0, listen: [{ box: 'dict.strip', outlet: 1, label: 'removed' }, { box: 'route' }, { box: 'dict.unpack' }, { box: 'dict.unpack', outlet: 1, label: 'rest' }] });
    expect(r.heard.removed[0].msg).toEqual(['amp', 0.2]);
    expect(nums(r.heard.route)[0]).toBe(0.2);
    expect(nums(r.heard['dict.unpack']).slice(0, 3)).toEqual([220, 275, 330]);
    expect(r.heard.rest).toEqual([]); // nothing but freq left in the dictionary
    expect(rmsAt(r.left, r.heard['dict.unpack'], 0, 0.3)).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(pitchAt(r.left, r.heard['dict.unpack'], 1, 0.3)).toBeCloseTo(275, -1);
  });
});

describe('dict.unpack/0: Reading values out of a dictionary', () => {
  it('"the tone alternates between a loud 220 Hz and a softer 440 Hz"', async () => {
    const r = await run('dict.unpack', 0, { seconds: 1.7, listen: [{ box: 'dict.unpack' }, { box: 'dict.unpack', outlet: 1, label: 'amp' }] });
    expect(nums(r.heard['dict.unpack']).slice(0, 4)).toEqual([220, 440, 220, 440]);
    expect(nums(r.heard.amp).slice(0, 4)).toEqual([0.25, 0.08, 0.25, 0.08]);
    const h = r.heard['dict.unpack'];
    expect(pitchAt(r.left, h, 0, 0.4)).toBeCloseTo(220, -1);
    expect(pitchAt(r.left, h, 1, 0.4)).toBeCloseTo(440, -1);
    expect(rmsAt(r.left, h, 0, 0.4)).toBeCloseTo(0.25 / Math.SQRT2, 2);
    expect(rmsAt(r.left, h, 1, 0.4)).toBeCloseTo(0.08 / Math.SQRT2, 2);
  });
});

describe('fromsymbol/0: Numbers from text', () => {
  it('"the text "60 64 67 72" becomes four numbers again ... zl.nth can pick the notes out one by one"', async () => {
    const r = await run('fromsymbol', 0, { seconds: 1.1, listen: [{ box: 'tosymbol' }, { box: 'fromsymbol' }, { box: 'zl.nth' }] });
    expect(r.heard.tosymbol[0].msg).toEqual(['60 64 67 72']);
    expect(r.heard.fromsymbol[0].msg).toEqual([60, 64, 67, 72]);
    expect(nums(r.heard['zl.nth']).slice(0, 4)).toEqual([60, 64, 67, 72]);
    expect(pitchAt(r.left, r.heard['zl.nth'], 3, 0.25)).toBeCloseTo(mtof(72), -1);
  });
});

describe('funbuff/0: Notes at a few points in time', () => {
  it('"each note holds until the next" (what you hear)', async () => {
    const r = await run('funbuff', 0, { seconds: 2.1, listen: [{ box: 'counter' }] });
    const want = [60, 60, 67, 64, 64, 64, 72, 72];
    r.heard.counter.slice(0, 8).forEach((h, i) => expect(pitch(r.left, h.t + 0.03, h.t + 0.23)).toBeCloseTo(mtof(want[i]), -1));
  });
  it.fails('BUG: engine funbuff sends nothing (a bang from outlet 2) at an x with nothing stored; Max "uses the closest x value which is less than the number received"', async () => {
    const r = await run('funbuff', 0, { seconds: 2.1, listen: [{ box: 'funbuff' }] });
    expect(nums(r.heard.funbuff).slice(0, 8)).toEqual([60, 60, 67, 64, 64, 64, 72, 72]);
  });
});

describe('histo/0: Counting how often each note comes round', () => {
  it('"sends out how many times that step has now come round ... up a whole tone each time ... after six laps it starts again"', async () => {
    const r = await run('histo', 0, { seconds: 7.5, listen: [{ box: 'histo' }, { box: 'histo', outlet: 1, label: 'count' }, { box: '+ 60' }, { box: '+ 36' }] });
    const steps = nums(r.heard.histo);
    expect(steps.slice(0, 8)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
    expect(nums(r.heard['+ 60']).slice(0, 4)).toEqual([60, 64, 68, 72]);
    const counts = nums(r.heard.count);
    counts.forEach((c, i) => expect(c).toBe(Math.floor(i / 4) + 1));
    expect(r.heard.count[0].t).toBeLessThanOrEqual(r.heard.histo[0].t); // count leaves first (right to left)
    const laps = nums(r.heard['+ 36']).filter((_, i) => i % 4 === 0);
    expect(laps.slice(0, 7)).toEqual([38, 40, 42, 44, 46, 36, 38]);
  });
});

describe('itoa/0: Type a number, character by character', () => {
  it('"54 48" becomes the text "60" ... the notes climb from 60 to 67', async () => {
    const r = await run('itoa', 0, { seconds: 2.1, listen: [{ box: 'prepend' }, { box: 'itoa' }, { box: 'fromsymbol' }] });
    expect(r.heard.prepend[0].msg).toEqual([54, 48]);
    expect(r.heard.itoa.slice(0, 8).map((h) => h.msg)).toEqual(['60', '61', '62', '63', '64', '65', '66', '67'].map((s) => [s]));
    expect(nums(r.heard.fromsymbol).slice(0, 8)).toEqual([60, 61, 62, 63, 64, 65, 66, 67]);
    expect(pitchAt(r.left, r.heard.fromsymbol, 7, 0.25)).toBeCloseTo(mtof(67), -1);
  });
});

describe('match/0: Ring a bell on a pattern', () => {
  it('"match 7 0 waits for the numbers 7 then 0 in a row ... a high bell rings at the top of every bar"', async () => {
    const r = await run('match', 0, { seconds: 4.9, listen: [{ box: 'counter' }, { box: 'match' }] });
    const steps = nums(r.heard.counter);
    const bars = r.heard.counter.filter((_h, i) => i > 0 && steps[i] === 0 && steps[i - 1] === 7).map((h) => h.t);
    expect(bars.length).toBe(3);                       // bar lines at 1.6, 3.2, 4.8 s; none at the very start
    expect(r.heard.match.map((h) => h.msg)).toEqual(bars.map(() => [7, 0]));
    expect(r.heard.match.map((h) => h.t)).toEqual(bars);
    const t = bars[0];
    // the 1568 Hz bell (0.2) adds to the 0.2 tune: louder right after the bar line than before it
    expect(rms(r.left, t + 0.01, t + 0.1)).toBeGreaterThan(1.3 * rms(r.left, t - 0.15, t - 0.02));
  });
});

describe('spell/0: Spell a word out in notes', () => {
  it('"one letter plays per beat" (h e l l o, less 36)', async () => {
    const r = await run('spell', 0, { seconds: 2.6, listen: [{ box: '- 36' }] });
    expect(nums(r.heard['- 36']).slice(0, 10)).toEqual([68, 65, 72, 72, 75, 68, 65, 72, 72, 75]);
    expect(pitchAt(r.left, r.heard['- 36'], 1, 0.25)).toBeCloseTo(mtof(65), -1);
  });
  it.fails('BUG: engine spell sends one list (104 101 108 108 111); Max sends the codes "one character at a time" (engine zl.queue splitting lists into items, unlike Max, hides it)', async () => {
    const r = await run('spell', 0, { seconds: 0.3, listen: [{ box: 'spell' }] });
    expect(r.heard.spell.map((h) => h.msg)).toEqual([[104], [101], [108], [108], [111]]);
  });
});

describe('table/0: A melody in a table', () => {
  it('"set 0 60 63 ..." writes them from position 0 on ... The counter reads positions 0 to 7', async () => {
    const r = await run('table', 0, { seconds: 2.6, listen: [{ box: 'table' }] });
    expect(nums(r.heard.table).slice(0, 10)).toEqual([60, 63, 65, 67, 70, 67, 65, 63, 60, 63]);
    expect(pitchAt(r.left, r.heard.table, 4, 0.25)).toBeCloseTo(mtof(70), -1);
  });
});

describe('tosymbol/0: Hear the digits', () => {
  it('"the text "60 64 67" ... 6 is 54, a space 32, and those codes play as a tune"', async () => {
    const r = await run('tosymbol', 0, { seconds: 1.7, listen: [{ box: 'tosymbol' }, { box: 'atoi' }, { box: '+ 12' }] });
    expect(r.heard.tosymbol[0].msg).toEqual(['60 64 67']);
    expect(r.heard.atoi[0].msg).toEqual([54, 48, 32, 54, 52, 32, 54, 55]);
    expect(nums(r.heard['+ 12']).slice(0, 8)).toEqual([66, 60, 44, 66, 64, 44, 66, 67]);
    expect(pitchAt(r.left, r.heard['+ 12'], 2, 0.2)).toBeCloseTo(mtof(44), -1);
  });
});

// ── Bitwise and comparison operators ─────────────────────────────────────────

/** Run a counter-driven operator example and return the counter stream, the operator stream and a later box. */
async function chain(object: string, index: number, op: string, after: string, seconds: number, src = 'counter') {
  const r = await run(object, index, { seconds, listen: [{ box: src }, { box: op }, { box: after }] });
  return { r, input: nums(r.heard[src]), out: nums(r.heard[op]), later: nums(r.heard[after]) };
}

describe('bitand/0: Masking bits into a pattern', () => {
  it('"Counting 0..7, & 5 (binary 101) gives 0 1 0 1 4 5 4 5; times 2 above note 60"', async () => {
    const { r, out, later } = await chain('bitand', 0, '&', '+ 60', 1.5);
    expect(out.slice(0, 8)).toEqual([0, 1, 0, 1, 4, 5, 4, 5]);
    expect(later.slice(0, 8)).toEqual([60, 62, 60, 62, 68, 70, 68, 70]);
    expect(pitchAt(r.left, r.heard['+ 60'], 5, 0.18)).toBeCloseTo(mtof(70), -1);
  });
});

describe('bitand/1: One bit, a slower beat', () => {
  it('"four notes on C, then four on the E above, over and over"', async () => {
    const { r, later } = await chain('bitand', 1, 'bitand', '+ 60', 2.5);
    expect(later.slice(0, 16)).toEqual([60, 60, 60, 60, 64, 64, 64, 64, 60, 60, 60, 60, 64, 64, 64, 64]);
    expect(pitchAt(r.left, r.heard['+ 60'], 5, 0.15)).toBeCloseTo(mtof(64), -1);
  });
});

describe('bitor/0: Forcing a bit on', () => {
  it('"Counting 0..7, | 4 gives 4 5 6 7 4 5 6 7 ... the same four notes twice"', async () => {
    const { r, out, later } = await chain('bitor', 0, '|', '+ 58', 1.5);
    expect(out.slice(0, 8)).toEqual([4, 5, 6, 7, 4, 5, 6, 7]);
    expect(later.slice(0, 8)).toEqual([66, 68, 70, 72, 66, 68, 70, 72]);
    expect(pitchAt(r.left, r.heard['+ 58'], 0, 0.18)).toBeCloseTo(mtof(66), -1);
  });
});

describe('bitor/1: Only odd notes', () => {
  it('"every random number 0..11 becomes odd: above note 60 that leaves 61, 63, 65, 67, 69, 71"', async () => {
    const { input, out, later } = await chain('bitor', 1, 'bitor', '+ 60', 6, 'random');
    input.forEach((n, i) => { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(12); expect(out[i]).toBe(n | 1); });
    for (const n of later) expect([61, 63, 65, 67, 69, 71]).toContain(n);
  });
});

describe('equals/0: Is it this beat?', () => {
  it('"Beat 0 of every eight gives 1, times 12 an octave up"', async () => {
    const { r, out, later } = await chain('equals', 0, '==', '+ 60', 3.3);
    expect(out.slice(0, 16)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(later.slice(0, 9)).toEqual([72, 60, 60, 60, 60, 60, 60, 60, 72]);
    expect(pitchAt(r.left, r.heard['+ 60'], 0, 0.2)).toBeCloseTo(mtof(72), -1);
  });
});

describe('equals/1: A random rhythm', () => {
  it('"random picks 0..3 ... equals 2 outputs 1 only when it picks 2 ... about one tick in four"', async () => {
    const { r, input, out } = await chain('equals', 1, 'equals', '*~ 0.0', 6, 'random');
    input.forEach((n, i) => { expect([0, 1, 2, 3]).toContain(n); expect(out[i]).toBe(n === 2 ? 1 : 0); });
    expect(frac(out, 1)).toBeGreaterThan(0.12);
    expect(frac(out, 1)).toBeLessThan(0.4);
    const on = out.indexOf(1), off = out.indexOf(0);
    expect(rmsAt(r.left, r.heard.equals, on, 0.125)).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(rmsAt(r.left, r.heard.equals, off, 0.125)).toBeLessThan(0.005);
  });
});

describe('greaterthan/0: Sometimes a fifth higher', () => {
  it('"random picks 0..99, and > 70 is 1 about 30% of the time: those ticks jump from middle C up a fifth"', async () => {
    const { input, out, later } = await chain('greaterthan', 0, '>', '+ 60', 8, 'random');
    input.forEach((n, i) => { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(100); expect(out[i]).toBe(n > 70 ? 1 : 0); });
    expect(frac(out, 1)).toBeGreaterThan(0.15);
    expect(frac(out, 1)).toBeLessThan(0.45);
    for (const n of later) expect([60, 67]).toContain(n);
  });
});

describe('greaterthan/1: Brighter at the end of the phrase', () => {
  it('"greaterthan 11 is 1 for the last four steps, which opens lores~ from 300 to 2300 Hz: ... turns bright"', async () => {
    const { r, input, later } = await chain('greaterthan', 1, 'greaterthan', '+ 300', 2.45);
    input.forEach((n, i) => expect(later[i]).toBe(n > 11 ? 2300 : 300));
    // brightness: high-frequency content, as rms of the first difference relative to rms
    const bright = (t0: number, t1: number) => {
      const d = new Float32Array(Math.round((t1 - t0) * 44100));
      for (let i = 1; i < d.length; i++) d[i] = r.left[Math.round(t0 * 44100) + i] - r.left[Math.round(t0 * 44100) + i - 1];
      return rms(d, 0, t1 - t0) / rms(r.left, t0, t1);
    };
    const t12 = r.heard.counter[12].t;
    expect(bright(t12 + 0.05, t12 + 0.55)).toBeGreaterThan(2 * bright(0.3, 1.6));
  });
});

describe('greaterthaneq/0: Louder from middle C up', () => {
  it('"plays softly until it reaches 60, where >= 60 turns 1 and the volume jumps up (scale maps 0 and 1 to 0.25 and 1)"', async () => {
    const { r, input, out, later } = await chain('greaterthaneq', 0, '>=', 'scale', 3);
    input.forEach((n, i) => expect(out[i]).toBe(n >= 60 ? 1 : 0));
    expect(new Set(later)).toEqual(new Set([0.25, 1]));
    const i60 = input.indexOf(60);
    expect(input[0]).toBe(48);
    const loud = rmsAt(r.left, r.heard.counter, i60 + 1, 0.15), soft = rmsAt(r.left, r.heard.counter, i60 - 2, 0.15);
    expect(loud).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(loud / soft).toBeCloseTo(4, 0);
  });
});

describe('greaterthaneq/1: A coin toss between octaves', () => {
  it('"greaterthaneq 50 is 1 half the time: ... between A 57 and the A an octave up"', async () => {
    const { input, out, later } = await chain('greaterthaneq', 1, 'greaterthaneq', '+ 57', 6, 'random');
    input.forEach((n, i) => expect(out[i]).toBe(n >= 50 ? 1 : 0));
    expect(frac(out, 1)).toBeGreaterThan(0.3);
    expect(frac(out, 1)).toBeLessThan(0.7);
    for (const n of later) expect([57, 69]).toContain(n);
  });
});

describe('lessthan/0: Two halves of a bar', () => {
  it('"< 4 is 1 for the first four beats ... note 65 four times and then 60 four times"', async () => {
    const { r, out, later } = await chain('lessthan', 0, '<', '+ 60', 1.7);
    expect(out.slice(0, 8)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(later.slice(0, 8)).toEqual([65, 65, 65, 65, 60, 60, 60, 60]);
    expect(pitchAt(r.left, r.heard['+ 60'], 0, 0.2)).toBeCloseTo(mtof(65), -1);
    expect(pitchAt(r.left, r.heard['+ 60'], 5, 0.2)).toBeCloseTo(mtof(60), -1);
  });
});

describe('lessthan/1: How busy is the rhythm?', () => {
  it('"lessthan 30 is 1 about 30% of the time, and that opens the tone"', async () => {
    const { r, input, out } = await chain('lessthan', 1, 'lessthan', '*~ 0.0', 6, 'random');
    input.forEach((n, i) => expect(out[i]).toBe(n < 30 ? 1 : 0));
    expect(frac(out, 1)).toBeGreaterThan(0.15);
    expect(frac(out, 1)).toBeLessThan(0.45);
    expect(rmsAt(r.left, r.heard.lessthan, out.indexOf(1), 0.1)).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(rmsAt(r.left, r.heard.lessthan, out.indexOf(0), 0.1)).toBeLessThan(0.005);
  });
});

describe('lessthaneq/0: Accents at the start of the bar', () => {
  it('"<= 1 is 1 on the first two beats; times 0.7 plus 0.3 makes those loud and the rest soft"', async () => {
    const { r, out, later } = await chain('lessthaneq', 0, '<=', '+ 0.3', 1.5);
    expect(out.slice(0, 8)).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
    later.slice(0, 8).forEach((v, i) => expect(v).toBeCloseTo(i < 2 ? 1 : 0.3, 6));
    const h = r.heard['+ 0.3'];
    expect(rmsAt(r.left, h, 0, 0.18)).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(rmsAt(r.left, h, 3, 0.18)).toBeCloseTo(0.06 / Math.SQRT2, 2);
  });
});

describe('lessthaneq/1: Lifting the low notes', () => {
  it('"lessthaneq 65 gives 1 for notes up to 65 ... so the low notes play an octave up"', async () => {
    const { input, later } = await chain('lessthaneq', 1, 'lessthaneq', '+ 0', 6, '+ 54');
    expect(later.length).toBe(input.length);
    input.forEach((n, i) => { expect(n).toBeGreaterThanOrEqual(54); expect(n).toBeLessThan(78); expect(later[i]).toBe(n <= 65 ? n + 12 : n); });
  });
});

describe('logand/0: Both conditions at once', () => {
  it('"only beats 5 and 7 are both, and jump an octave"', async () => {
    const { r, out, later } = await chain('logand', 0, '&&', 'scale', 1.7);
    expect(out.slice(0, 8)).toEqual([0, 0, 0, 0, 0, 1, 0, 1]);
    expect(later.slice(0, 8)).toEqual([60, 60, 60, 60, 60, 72, 60, 72]);
    expect(pitchAt(r.left, r.heard.scale, 5, 0.2)).toBeCloseTo(mtof(72), -1);
  });
});

/** The two-coin examples: coin values per tick and the operator's output. */
async function coins(object: string, op: string) {
  const r = await run(object, 1, { seconds: 8, listen: [{ box: 'random', label: 'c1' }, { box: 'random', nth: 1, label: 'c2' }, { box: op }] });
  return { r, c1: nums(r.heard.c1), c2: nums(r.heard.c2), out: nums(r.heard[op]) };
}

describe('logand/1: Two coins, both heads', () => {
  it('"It is 1 only when both are heads, so the tone plays about one tick in four"', async () => {
    const { r, c1, c2, out } = await coins('logand', 'logand');
    expect(out.length).toBe(c1.length);
    expect(r.heard.c2[0].t).toBe(r.heard.c1[0].t);
    out.forEach((v, i) => expect(v).toBe(c1[i] && c2[i] ? 1 : 0));
    expect(frac(out, 1)).toBeGreaterThan(0.12);
    expect(frac(out, 1)).toBeLessThan(0.4);
  });
});

describe('logor/0: A pickup into the downbeat', () => {
  it('"beats 6, 7 and 0 jump an octave"', async () => {
    const { r, out, later } = await chain('logor', 0, '||', 'scale', 3.3);
    expect(out.slice(0, 16)).toEqual([1, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1]);
    expect(later.slice(0, 8)).toEqual([74, 62, 62, 62, 62, 62, 74, 74]);
    expect(pitchAt(r.left, r.heard.scale, 6, 0.2)).toBeCloseTo(mtof(74), -1);
  });
});

describe('logor/1: Two coins, either heads', () => {
  it('"It is 1 when either is heads, so the tone plays about three ticks in four"', async () => {
    const { c1, c2, out } = await coins('logor', 'logor');
    out.forEach((v, i) => expect(v).toBe(c1[i] || c2[i] ? 1 : 0));
    expect(frac(out, 1)).toBeGreaterThan(0.6);
    expect(frac(out, 1)).toBeLessThan(0.88);
  });
});

describe('notequals/0: Three beats on, one off', () => {
  it('"Counting 0..3, != 3 gives 1 1 1 0 ... the tone plays three beats and rests on the fourth"', async () => {
    const { r, out } = await chain('notequals', 0, '!=', '*~ 0.0', 1.7);
    expect(out.slice(0, 8)).toEqual([1, 1, 1, 0, 1, 1, 1, 0]);
    const h = r.heard['!='];
    expect(rmsAt(r.left, h, 1, 0.2)).toBeCloseTo(0.2 / Math.SQRT2, 2);
    expect(pitchAt(r.left, h, 1, 0.2)).toBeCloseTo(330, -1);
    expect(rmsAt(r.left, h, 3, 0.2)).toBeLessThan(0.005);
  });
});

describe('notequals/1: Mostly high, sometimes low', () => {
  it('"notequals 0 is 1 four times in five: ... middle C (60) mostly, and the F below (53) when random picks 0"', async () => {
    const { input, out, later } = await chain('notequals', 1, 'notequals', '+ 53', 8, 'random');
    input.forEach((n, i) => { expect([0, 1, 2, 3, 4]).toContain(n); expect(out[i]).toBe(n !== 0 ? 1 : 0); expect(later[i]).toBe(n !== 0 ? 60 : 53); });
    expect(frac(out, 1)).toBeGreaterThan(0.65);
    expect(frac(out, 1)).toBeLessThan(0.92);
  });
});

// ── Jitter ───────────────────────────────────────────────────────────────────

describe('jit.3m/0: A webcam theremin', () => {
  it('"the minimum, mean and maximum of each plane (alpha, red, green, blue, 0 to 255), out its left, middle and right outlets"', async () => {
    const { heard } = await runVideo('jit.3m', 0, undefined, { listen: [{ box: 'jit.3m', label: 'min' }, { box: 'jit.3m', outlet: 1, label: 'mean' }, { box: 'jit.3m', outlet: 2, label: 'max' }] });
    const [mn, me, mx] = [heard.min.at(-1)!.msg, heard.mean.at(-1)!.msg, heard.max.at(-1)!.msg] as number[][];
    expect(me[0]).toBe(255); expect(me[2]).toBeCloseTo(100, 0); expect(me[3]).toBeCloseTo(50, 0);
    expect(me[1]).toBeCloseTo(127.5, -1);
    expect(mn.slice(2)).toEqual([100, 50]); expect(mx.slice(2)).toEqual([100, 50]);
    // the test picture's red runs 0..255: exact in Max
    expect(mn[1]).toBeLessThanOrEqual(5);
    expect(mx[1]).toBeGreaterThanOrEqual(250);
  });
  it('"the mean\'s green value ... is scaled to 150..900 Hz"', async () => {
    const { heard } = await runVideo('jit.3m', 0, undefined, { listen: [{ box: 'scale' }] });
    expect(heard.scale.at(-1)!.msg[0]).toBeCloseTo(150 + (100 / 255) * 750, 1);
  });
});

describe('jit.brcosa/0: A black-and-white camera', () => {
  it('"saturation 0 takes out the colour and contrast 1.5 makes it punchier"', async () => {
    const { shown } = await runVideo('jit.brcosa', 0);
    const s = shown[0];
    for (const fx of [0.05, 0.3, 0.6, 0.95]) {
      const [r, g, b] = s.rgb(fx, 0.5);
      expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
    }
    // contrast: a grey ramp 100..156 (no clipping) comes out with a wider spread (1.5 x, and 1.1 x brightness)
    const ramp = testPicture((cx, w, h) => { for (let x = 0; x < w; x++) { const v = Math.round(100 + (x * 56) / (w - 1)); cx.fillStyle = `rgb(${v},${v},${v})`; cx.fillRect(x, 0, 1, h); } });
    const g = (await runVideo('jit.brcosa', 0, ramp)).shown[0];
    const spread = g.rgb(0.95, 0.5)[1] - g.rgb(0.05, 0.5)[1];
    expect(spread).toBeGreaterThan(1.4 * 0.9 * 56);
  });
});

describe('jit.grab/0: Your camera in the patch', () => {
  it('"jit.pwindow shows the frames"', async () => {
    const { shown } = await runVideo('jit.grab', 0);
    const [r, g, b] = shown[0].rgb(0.5, 0.5);
    expect(r).toBeGreaterThan(120); expect(r).toBeLessThan(136);
    expect([g, b]).toEqual([100, 50]);
    expect(shown[0].rgb(0, 0.5)[0]).toBeLessThan(5);
  });
});

describe('jit.matrix/0: Pixelate the camera', () => {
  it('"Copying the camera into one only 40 by 30 pixels big, then showing it full size ... makes big square pixels"', async () => {
    const { shown } = await runVideo('jit.matrix', 0);
    const s = shown[0];
    expect(s.stepsAcross()).toBeLessThanOrEqual(39); // 40 blocks across
    expect(s.stepsAcross()).toBeGreaterThanOrEqual(30);
    // vertical detail too: a test picture with 240 rows of changing green shows at most 30 bands
    const rows = testPicture((cx, w, h) => { for (let y = 0; y < h; y++) { cx.fillStyle = `rgb(0,${y},0)`; cx.fillRect(0, y, w, 1); } });
    const v = (await runVideo('jit.matrix', 0, rows)).shown[0];
    const greens = new Set<number>();
    for (let i = 0; i < 240; i++) greens.add(v.rgb(0.5, (i + 0.5) / 240)[1]);
    expect(greens.size).toBeLessThanOrEqual(30);
  });
});

describe('jit.pwindow/0: A picture inside the patch', () => {
  it('"passes the frame on from its left outlet, so a second jit.pwindow can show it again"', async () => {
    const { shown } = await runVideo('jit.pwindow', 0);
    expect(shown.length).toBe(2);
    for (const fx of [0.1, 0.5, 0.9]) {
      expect(shown[1].rgb(fx, 0.5)).toEqual(shown[0].rgb(fx, 0.5));
      expect(shown[1].rgb(fx, 0.5).slice(1)).toEqual([100, 50]);
    }
  });
});

describe('jit.scalebias/0: Fade the camera to grey', () => {
  it('"each colour: 0.5 * in + 0.25" (colours 0 to 1)', async () => {
    const { shown } = await runVideo('jit.scalebias', 0);
    const s = shown[0];
    const [, g, b] = s.rgb(0.5, 0.5);
    expect(g).toBeCloseTo(0.5 * 100 + 63.75, -0.5);
    expect(b).toBeCloseTo(0.5 * 50 + 63.75, -0.5);
    expect(s.rgb(0, 0.5)[0]).toBeCloseTo(63.75, -0.5);
    expect(s.rgb(0.999, 0.5)[0]).toBeCloseTo(191.25, -0.5);
  });
});

describe('jit.window/0: Show the camera in a window', () => {
  it('"jit.window displays frames ... here it is drawn in the patch"', async () => {
    const { shown } = await runVideo('jit.window', 0);
    expect(shown.length).toBe(1);
    expect(shown[0].rgb(0.5, 0.5).slice(1)).toEqual([100, 50]);
  });
});

// ── Random ───────────────────────────────────────────────────────────────────

describe('decide/0: Flip a coin', () => {
  it('"decide outputs 0 or 1 at random on each bang. Times 12 plus 57 ... every 200 ms"', async () => {
    const r = await run('decide', 0, { seconds: 6, listen: [{ box: 'decide' }, { box: '+ 57' }] });
    const coin = nums(r.heard.decide);
    for (const c of coin) expect([0, 1]).toContain(c);
    expect(coin).toContain(0); expect(coin).toContain(1);
    nums(r.heard['+ 57']).forEach((n, i) => expect(n).toBe(57 + 12 * coin[i]));
    for (let i = 1; i < r.heard.decide.length; i++) expect(r.heard.decide[i].t - r.heard.decide[i - 1].t).toBeCloseTo(0.2, 2);
  });
});

describe('drunk/0: A random walk', () => {
  it('"within 0..23, so the melody wanders instead of jumping"', async () => {
    const r = await run('drunk', 0, { seconds: 8, listen: [{ box: 'drunk' }] });
    const w = nums(r.heard.drunk);
    for (const v of w) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(23); }
  });
  it.fails('BUG: "a random step (up to 3)" - Max drunk 24 3 steps by less than 3 ("absolute value of the step size will always be less than ... this limit", so at most 2); the engine steps up to 3', async () => {
    const r = await run('drunk', 0, { seconds: 8, listen: [{ box: 'drunk' }] });
    const w = nums(r.heard.drunk);
    for (let i = 1; i < w.length; i++) expect(Math.abs(w[i] - w[i - 1])).toBeLessThanOrEqual(2);
  });
});

describe('random/0: Random notes', () => {
  it('"from 0 up to (not including) its argument ... here 0..23, shifted up to MIDI notes 48..71"', async () => {
    const r = await run('random', 0, { seconds: 10, listen: [{ box: 'random' }, { box: '+ 48' }] });
    const v = nums(r.heard.random);
    for (const n of v) { expect(Number.isInteger(n)).toBe(true); expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(23); }
    expect(nums(r.heard['+ 48'])).toEqual(v.map((n) => n + 48));
    expect(new Set(v).size).toBeGreaterThan(12); // spread over the range
  });
});

describe('urn/0: Shuffle, no repeats', () => {
  it('"each run of 8 notes plays every note of the scale once, in a new order"; "When all 8 are used it bangs its right outlet"', async () => {
    const r = await run('urn', 0, { seconds: 8, listen: [{ box: 'urn' }, { box: 'urn', outlet: 1, label: 'empty' }, { box: '+ 60' }] });
    const v = nums(r.heard.urn);
    expect(v.length).toBeGreaterThanOrEqual(32);
    const runs: number[][] = [];
    for (let i = 0; i + 8 <= v.length; i += 8) runs.push(v.slice(i, i + 8));
    for (const run8 of runs) expect([...run8].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(runs.some((x, i) => i > 0 && x.join() !== runs[i - 1].join())).toBe(true);
    // one right-outlet bang per run of 8
    expect(r.heard.empty.length).toBe(Math.floor(v.length / 8));
    for (const n of nums(r.heard['+ 60'])) expect([60, 62, 64, 66, 68, 70, 72, 74]).toContain(n);
  });
});
