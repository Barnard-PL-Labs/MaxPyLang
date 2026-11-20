// jit.brcosa / jit.scalebias — simple per-frame colour ops. Both manifest as
// 1 inlet, 2 outlets [video, control]: a video pipe with a control status outlet.
//
//   • jit.brcosa   — brightness / contrast / saturation, via the 2D canvas filter. As in
//     Max they are attributes (@brightness 1.1), also settable by message (brightness 1.1);
//     each defaults to 1.
//   • jit.scalebias — as in Max (mode 0): each plane out = in * <plane>scale + <plane>bias,
//     with values 0..1, from @ascale @rscale @gscale @bscale @abias @rbias @gbias @bbias
//     (scale 1, bias 0). Max's @scale/@bias apply only in mode 1 (channel summing), which
//     is not done here.
//
// Both process each incoming frame onto an internal canvas and re-expose it through
// videoOuts[0]. Headless: no canvas, videoIn no-op, getFrame() undefined.

import { register, type MaxNode, type VideoFrame } from '../../engine/registry';
import type { Msg } from '../../runtime/atoms';
import { attrNums, makeCanvas, videoSkeleton } from './_shared';

/** A frame-transform pipe: draw incoming frame through `apply`, re-expose result. */
function pipe(apply: (ctx: CanvasRenderingContext2D, frame: VideoFrame) => void, onMessage?: (m: Msg) => void): MaxNode {
  const skel = videoSkeleton(1);
  if (onMessage) skel.controlIns = [onMessage];
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

/** Settings from @attributes, updatable by "name value" messages. */
function settings(args: (number | string)[], node: { attrs?: Record<string, string[]> } | undefined, defaults: Record<string, number>) {
  const v: Record<string, number> = { ...defaults };
  for (const k of Object.keys(defaults)) { const n = attrNums(args, node, k); if (n) v[k] = n[0]; }
  const onMessage = (m: Msg) => {
    const [k, x] = m;
    if (typeof k === 'string' && k in v && typeof x === 'number') v[k] = x;
  };
  return { v, onMessage };
}

register('jit.brcosa', (args, { node }) => {
  const { v, onMessage } = settings(args, node, { brightness: 1, contrast: 1, saturation: 1 });
  return pipe((ctx, frame) => {
    ctx.filter = `brightness(${v.brightness}) contrast(${v.contrast}) saturate(${v.saturation})`;
    ctx.drawImage(frame.source, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.filter = 'none';
  }, onMessage);
});

register('jit.scalebias', (args, { node }) => {
  const { v, onMessage } = settings(args, node, {
    ascale: 1, rscale: 1, gscale: 1, bscale: 1, abias: 0, rbias: 0, gbias: 0, bbias: 0,
  });
  return pipe((ctx, frame) => {
    const { width, height } = ctx.canvas;
    ctx.drawImage(frame.source, 0, 0, width, height);
    const img = ctx.getImageData(0, 0, width, height);
    const d = img.data; // RGBA, 0..255
    const s = [v.rscale, v.gscale, v.bscale, v.ascale];
    const b = [v.rbias * 255, v.gbias * 255, v.bbias * 255, v.abias * 255];
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 4; c++) d[i + c] = d[i + c] * s[c] + b[c]; // clamped by the array
    }
    ctx.putImageData(img, 0, 0);
  }, onMessage);
});
