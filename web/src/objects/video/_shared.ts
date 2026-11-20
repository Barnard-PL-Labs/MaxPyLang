// Shared helpers for the Jitter (video) object subset.
//
// HEADLESS SAFETY IS THE WHOLE POINT of this module: the signature/fuzz tests build
// every jit.* object in Node with no `document`, no `navigator`, no canvas. Every DOM
// access below is guarded, and the factories fall back to an inert-but-shaped node
// (video ports present, no real capture) when the browser APIs are absent.

import { num, type MaxNode, type VideoFrame } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import type { ArgValue } from '../../ir/types';

export const hasDOM = (): boolean => typeof document !== 'undefined';

/** Create a 2D canvas of the given size, or undefined when there is no DOM. */
export function makeCanvas(w: number, h: number): HTMLCanvasElement | undefined {
  if (!hasDOM()) return undefined;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Pixel dimensions of any drawable frame source (video vs canvas/image differ). */
export function frameSize(src: CanvasImageSource): { w: number; h: number } {
  const anyChar = src as unknown as {
    videoWidth?: number; videoHeight?: number; width?: number; height?: number;
  };
  const w = anyChar.videoWidth || anyChar.width || 0;
  const h = anyChar.videoHeight || anyChar.height || 0;
  return { w, h };
}

/**
 * A control-plumbing skeleton shared by every jit.* video object: a control outlet
 * (`onControlOut`, so it satisfies the manifest's control-outlet contract) and a
 * no-op control inlet per manifest inlet. Video ports are layered on by the caller.
 */
export function videoSkeleton(numInlets: number): Pick<MaxNode, 'signalIns' | 'signalOuts' | 'controlIns' | 'onControlOut'> {
  const o = makeOutlets();
  const controlIns = Array.from({ length: Math.max(1, numInlets) }, () => () => {});
  return { signalIns: [], signalOuts: [], controlIns, onControlOut: o.onControlOut };
}

/** A box attribute (@name value…) as numbers, from the parsed attributes or the args. */
export function attrNums(args: ArgValue[], node: { attrs?: Record<string, string[]> } | undefined, key: string): number[] | undefined {
  const fromAttrs = node?.attrs?.[key];
  const raw = fromAttrs ?? (() => {
    const at = args.indexOf('@' + key);
    if (at < 0) return undefined;
    const out: string[] = [];
    for (let i = at + 1; i < args.length && !String(args[i]).startsWith('@'); i++) out.push(String(args[i]));
    return out;
  })();
  if (!raw) return undefined;
  const vals = raw.map(Number).filter((n) => Number.isFinite(n));
  return vals.length ? vals : undefined;
}

/**
 * A jit.matrix's size, read as Max reads its arguments: [name] planecount type dim…
 * ("jit.matrix 4 char 320 240"), or @dim w h. The numbers after the type are the size.
 */
export function matrixDims(args: ArgValue[], node: { attrs?: Record<string, string[]> } | undefined, defW: number, defH: number): { w: number; h: number } {
  const dim = attrNums(args, node, 'dim');
  if (dim) return { w: Math.max(1, Math.round(dim[0])), h: Math.max(1, Math.round(dim[1] ?? 1)) };
  const types = ['char', 'long', 'float32', 'float64'];
  const t = args.findIndex((a) => typeof a === 'string' && types.includes(a));
  if (t >= 0) {
    const after = args.slice(t + 1).filter((a): a is number => typeof a === 'number');
    return { w: Math.max(1, Math.round(num(after[0], defW))), h: Math.max(1, Math.round(num(after[1], 1))) };
  }
  return dimsFromArgs(args, defW, defH);
}

/** Parse two leading numeric args as a width/height, with defaults. */
export function dimsFromArgs(args: ArgValue[], defW: number, defH: number): { w: number; h: number } {
  const nums = args.filter((a): a is number => typeof a === 'number' && Number.isFinite(a));
  return {
    w: Math.max(1, Math.round(num(nums[0], defW))),
    h: Math.max(1, Math.round(num(nums[1], defH))),
  };
}

/** Draw a frame into a canvas at the canvas's own size, pixelated (no smoothing). */
export function blitPixelated(canvas: HTMLCanvasElement, frame: VideoFrame): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frame.source, 0, 0, canvas.width, canvas.height);
}
