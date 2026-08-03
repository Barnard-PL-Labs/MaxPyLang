// jit.brcosa / jit.scalebias — simple per-frame colour ops. Both manifest as
// 1 inlet, 2 outlets [video, control]: a video pipe with a control status outlet.
//
//   • jit.brcosa   — brightness / contrast / saturation, via the 2D canvas filter.
//     Args: brightness contrast saturation (defaults 1 1 1).
//   • jit.scalebias — out = scale*in + bias per channel. Approximated with a
//     brightness(scale) filter plus an additive bias overlay. Args: scale bias.
//
// Both process each incoming frame onto an internal canvas and re-expose it through
// videoOuts[0]. Headless: no canvas, videoIn no-op, getFrame() undefined.

import { register, num, type MaxNode, type VideoFrame } from '../../engine/registry';
import { makeCanvas, videoSkeleton } from './_shared';

/** A frame-transform pipe: draw incoming frame through `apply`, re-expose result. */
function pipe(apply: (ctx: CanvasRenderingContext2D, frame: VideoFrame) => void): MaxNode {
  const skel = videoSkeleton(1);
  const canvas = makeCanvas(1, 1);
  let hasFrame = false;

  const videoIn = (frame: VideoFrame): void => {
    if (!canvas) return;
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = Math.max(1, frame.width);
      canvas.height = Math.max(1, frame.height);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    apply(ctx, frame);
    hasFrame = true;
  };

  return {
    ...skel,
    videoIns: [videoIn],
    videoOuts: [
      { getFrame: () => (canvas && hasFrame ? { source: canvas, width: canvas.width, height: canvas.height } : undefined) },
      undefined,
    ],
  } satisfies MaxNode;
}

register('jit.brcosa', (args) => {
  const brightness = num(args[0], 1);
  const contrast = num(args[1], 1);
  const saturation = num(args[2], 1);
  return pipe((ctx, frame) => {
    ctx.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
    ctx.drawImage(frame.source, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.filter = 'none';
  });
});

register('jit.scalebias', (args) => {
  const scale = num(args[0], 1);
  const bias = num(args[1], 0);
  return pipe((ctx, frame) => {
    ctx.filter = `brightness(${scale})`;
    ctx.drawImage(frame.source, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.filter = 'none';
    if (bias !== 0) {
      // Additive bias: lighten the whole frame by a constant (bias in 0..1 units).
      ctx.globalCompositeOperation = 'lighter';
      const v = Math.round(Math.max(0, Math.min(1, bias)) * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.globalCompositeOperation = 'source-over';
    }
  });
});
