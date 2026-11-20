// jit.matrix — a fixed-size frame buffer. Manifest: 1 inlet, 2 outlets [video, control].
//
// Args as in Max: [name] planecount type dim…, e.g. "jit.matrix 4 char 160 120", or
// @dim w h. Only the size is used: each incoming frame is drawn (nearest-neighbour)
// into an offscreen canvas of that size. Downsampling to a small buffer, then displaying it
// enlarged in jit.window, is exactly what produces the pixelation in the demo.
//
// Headless: no canvas, videoIn is a no-op, getFrame() returns undefined.

import { register, type MaxNode, type VideoFrame } from '../../engine/registry';
import { makeCanvas, matrixDims, blitPixelated, videoSkeleton } from './_shared';

register('jit.matrix', (args, { node }) => {
  const skel = videoSkeleton(1);
  const { w, h } = matrixDims(args, node, 160, 120);
  const canvas = makeCanvas(w, h);
  let hasFrame = false;

  const videoIn = (frame: VideoFrame): void => {
    if (!canvas) return;
    blitPixelated(canvas, frame); // draws to the small buffer with smoothing off
    hasFrame = true;
  };

  const getFrame = (): VideoFrame | undefined =>
    canvas && hasFrame ? { source: canvas, width: canvas.width, height: canvas.height } : undefined;

  return {
    ...skel,
    videoIns: [videoIn],
    videoOuts: [{ getFrame }, undefined],
  } satisfies MaxNode;
});
