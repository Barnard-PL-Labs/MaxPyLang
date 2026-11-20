// Jitter objects as in Max, checked on real pixels: a frame of one known colour goes
// in, and what comes out is read back. No camera needed.
import { describe, expect, it } from 'vitest';
import '../../src/objects';
import { getFactory, type MaxNode, type VideoFrame } from '../../src/engine/registry';

const ctx = new OfflineAudioContext(1, 128, 44100);

/** A frame filled with one RGB colour. */
function solid(r: number, g: number, b: number, w = 64, h = 48): VideoFrame {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = `rgb(${r},${g},${b})`;
  x.fillRect(0, 0, w, h);
  return { source: c, width: w, height: h };
}

function build(name: string, args: (number | string)[] = [], attrs: Record<string, string[]> = {}): MaxNode {
  return getFactory(name)!(args, { ctx, node: { attrs } } as never);
}

/** The RGB of the middle pixel of what a pipe object sends on. */
function centre(node: MaxNode): number[] {
  const f = node.videoOuts![0]!.getFrame()!;
  const c = f.source as HTMLCanvasElement;
  const d = c.getContext('2d')!.getImageData(Math.floor(f.width / 2), Math.floor(f.height / 2), 1, 1).data;
  return [d[0], d[1], d[2]];
}

describe('Jitter objects', () => {
  it('jit.brcosa reads @saturation: 0 makes the picture grey', () => {
    const node = build('jit.brcosa', [], { saturation: ['0'] });
    node.videoIns![0]!(solid(200, 40, 40));
    const [r, g, b] = centre(node);
    expect(Math.abs(r - g)).toBeLessThan(3);
    expect(Math.abs(g - b)).toBeLessThan(3);
  });

  it('jit.brcosa takes a "saturation 0" message too', () => {
    const node = build('jit.brcosa');
    node.controlIns?.[0]?.(['saturation', 0]);
    node.videoIns![0]!(solid(200, 40, 40));
    const [r, g] = centre(node);
    expect(Math.abs(r - g)).toBeLessThan(3);
  });

  it('jit.scalebias: each colour is in * <colour>scale + <colour>bias (0..1)', () => {
    const node = build('jit.scalebias', [], {
      rscale: ['0.5'], gscale: ['0.5'], bscale: ['0.5'], rbias: ['0.25'], gbias: ['0.25'], bbias: ['0.25'],
    });
    node.videoIns![0]!(solid(200, 100, 0));
    const [r, g, b] = centre(node);
    expect(r).toBeCloseTo(200 * 0.5 + 63.75, -1);
    expect(g).toBeCloseTo(100 * 0.5 + 63.75, -1);
    expect(b).toBeCloseTo(63.75, -1);
  });

  it('jit.matrix reads Max\'s planecount type width height: "4 char 40 30" is 40 x 30', () => {
    const node = build('jit.matrix', [4, 'char', 40, 30]);
    node.videoIns![0]!(solid(10, 20, 30, 320, 240));
    const f = node.videoOuts![0]!.getFrame()!;
    expect([f.width, f.height]).toEqual([40, 30]);
  });

  it('jit.3m sends min, mean, max as per-plane lists (A R G B), left to right', () => {
    const node = build('jit.3m');
    const got: Record<number, number[]> = {};
    for (const i of [0, 1, 2]) node.onControlOut!(i, (m) => { got[i] = m as number[]; });
    node.videoIns![0]!(solid(200, 100, 50));
    for (const i of [0, 1, 2]) {
      expect(got[i].map(Math.round)).toEqual([255, 200, 100, 50]);
    }
  });
});
