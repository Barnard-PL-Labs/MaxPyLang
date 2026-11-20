// Video → control bridge. These jit.* objects consume frames on a video inlet and
// emit numbers on control outlets, so a webcam can drive a synth.

import { register, type MaxNode, type VideoFrame } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { hasDOM, makeCanvas } from './_shared';

// jit.3m : as in Max, the minimum, mean and maximum of each plane of the incoming
// matrix, as lists of one value per plane (A R G B, 0..255 for a char matrix):
//   outlet 0 = min   outlet 1 = mean   outlet 2 = max
register('jit.3m', () => {
  const o = makeOutlets();
  // A tiny analysis canvas keeps getImageData cheap at frame rate.
  const canvas = makeCanvas(32, 24);
  const cx = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;

  const onFrame = (frame: VideoFrame): void => {
    if (!canvas || !cx) return;
    try {
      cx.drawImage(frame.source, 0, 0, canvas.width, canvas.height);
      const { data } = cx.getImageData(0, 0, canvas.width, canvas.height);
      // Planes in Jitter's order: alpha, red, green, blue. Canvas data is R G B A.
      const order = [3, 0, 1, 2];
      const min = [255, 255, 255, 255], max = [0, 0, 0, 0], sum = [0, 0, 0, 0];
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        for (let p = 0; p < 4; p++) {
          const x = data[i + order[p]];
          if (x < min[p]) min[p] = x;
          if (x > max[p]) max[p] = x;
          sum[p] += x;
        }
      }
      // Right to left, as Max outputs.
      o.emit(2, max);
      o.emit(1, sum.map((t) => t / n));
      o.emit(0, min);
    } catch {
      // drawImage can throw before the camera has delivered a frame — skip it.
    }
  };

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [() => {}],
    videoIns: [hasDOM() ? onFrame : undefined],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});
