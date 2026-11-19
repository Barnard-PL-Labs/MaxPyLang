// layoutForReading arranges each example's patch top to bottom for the visual view.
import { describe, expect, it } from 'vitest';
import { layoutForReading } from '../src/patchview';
import examples from '../src/generated/examples.json';

type Box = { box: { id: string; patching_rect: [number, number, number, number] } };
type Patch = { patcher: { boxes: Box[]; lines: { patchline: { source: [string, number]; destination: [string, number] } }[] } };

describe('layoutForReading', () => {
  it.each(examples.map((e) => [`${e.object}/${e.index}`, e] as const))('%s reads top to bottom, without overlaps', (_, ex) => {
    const before = JSON.stringify(ex.patch);
    const laid = layoutForReading(ex.patch) as Patch;
    expect(JSON.stringify(ex.patch), 'leaves the original patch alone').toBe(before);

    const rect = new Map(laid.patcher.boxes.map(({ box }) => [box.id, box.patching_rect]));
    for (const r of rect.values()) expect(r.every(Number.isFinite)).toBe(true);

    // Every cord goes down, except the one a feedback loop needs (tapin~/tapout~ echoes).
    const upward = laid.patcher.lines.filter(({ patchline: l }) => rect.get(l.source[0])![1] >= rect.get(l.destination[0])![1]);
    expect(upward.length, 'cords going up').toBeLessThanOrEqual(ex.objects.includes('tapin~') ? 1 : 0);

    const rs = [...rect.values()];
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const [a, b] = [rs[i], rs[j]];
        const overlap = a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
        expect(overlap, 'boxes overlap').toBe(false);
      }
    }
  });
});
