// Video → control bridge. These jit.* objects consume frames on a video inlet and
// emit numbers on control outlets, so a webcam can drive a synth.

import { register, type MaxNode, type VideoFrame } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { hasDOM, makeCanvas } from './_shared';

// jit.3m : per-frame brightness statistics of the incoming matrix.
//   outlet 0 = mean   outlet 1 = min   outlet 2 = max   (all normalised 0..1)
// Point jit.grab at it and outlet 0 tracks how bright the scene is — cover the
// camera and it drops, so it plays like a light-controlled theremin.
// (Real jit.3m reports per-plane min/mean/max; we emit normalised luma, which is
// what a single-number control mapping actually wants.)
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
      let sum = 0;
      let min = 1;
      let max = 0;
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        const luma = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
        sum += luma;
        if (luma < min) min = luma;
        if (luma > max) max = luma;
      }
      o.emit(0, [sum / n]);
      o.emit(1, [min]);
      o.emit(2, [max]);
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
