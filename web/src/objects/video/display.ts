// jit.window / jit.pwindow — display an incoming video frame on a <canvas>.
//
//   • jit.window  (manifest: 1 inlet, 2 control outlets) — a display sink. Its `el`
//     canvas is mounted into the graph by ui/graph.ts.
//   • jit.pwindow (manifest: 1 inlet, 2 outlets [video, control]) — like jit.window
//     but also PASSES the frame through its video outlet.
//
// Both draw with smoothing OFF, so a small jit.matrix buffer upscaled here shows crisp
// chunky pixels — the pixelation. Headless: no canvas/el, videoIn is a no-op.

import { register, type MaxNode, type VideoFrame } from '../../engine/registry';
import { makeCanvas, blitPixelated, videoSkeleton } from './_shared';

/** Default on-screen display size; a small matrix buffer scales up to fill this. */
const DISPLAY_W = 320;
const DISPLAY_H = 240;

function makeDisplay(passthrough: boolean): MaxNode {
  const skel = videoSkeleton(1);
  const canvas = makeCanvas(DISPLAY_W, DISPLAY_H);
  if (canvas) {
    canvas.style.cssText = 'width:100%;height:100%;background:#000;image-rendering:pixelated;';
  }
  let last: VideoFrame | undefined;

  const videoIn = (frame: VideoFrame): void => {
    last = frame;
    if (canvas) blitPixelated(canvas, frame);
  };

  const node: MaxNode = {
    ...skel,
    videoIns: [videoIn],
    el: canvas,
  };
  if (passthrough) {
    node.videoOuts = [
      { getFrame: () => (canvas && last ? { source: canvas, width: canvas.width, height: canvas.height } : undefined) },
      undefined,
    ];
  }
  return node;
}

register('jit.window', () => makeDisplay(false));
register('jit.pwindow', () => makeDisplay(true));
