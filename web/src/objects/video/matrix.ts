// jit.matrix — a fixed-size frame buffer. Manifest: 1 inlet, 2 outlets [video, control].
//
// Args are `<width> <height> [planecount] [type]`, e.g. "jit.matrix 160 120 4 char".
// We only use width/height: each incoming frame is drawn (nearest-neighbour) into an
// offscreen canvas of that size. Downsampling to a small buffer, then displaying it
// enlarged in jit.window, is exactly what produces the pixelation in the demo.
//
// Headless: no canvas, videoIn is a no-op, getFrame() returns undefined.

import { register, type MaxNode, type VideoFrame } from '../../engine/registry';
import { makeCanvas, dimsFromArgs, blitPixelated, videoSkeleton } from './_shared';

register('jit.matrix', (args) => {
  const skel = videoSkeleton(1);
  const { w, h } = dimsFromArgs(args, 160, 120);
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
