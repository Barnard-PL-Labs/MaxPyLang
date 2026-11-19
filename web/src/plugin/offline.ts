// Render a generated device offline: play a buffer into plugin~, collect what leaves
// plugout~, as fast as the machine can go. This is how the browser engine is checked
// against Max. The same test signal is rendered through the same patch in both, and the
// two recordings are compared (levels, distortion, frequency response, echo times).
//
// Development only: the page exposes it on window.__fx when run from the dev server.

import { Engine } from '../engine/engine';
import { parseMaxPat } from '../parser/maxpat';
import { hostBus } from '../runtime/host';
import { preloadWorklets } from '../runtime/worklet';
import '../objects';

export async function renderOffline(json: unknown, input: AudioBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, input.length, input.sampleRate);
  await preloadWorklets(ctx);
  const engine = new Engine(ctx);
  const bus = hostBus(ctx);

  const source = new AudioBufferSourceNode(ctx, { buffer: input });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  source.connect(split);
  split.connect(bus.input[0], 0);
  split.connect(bus.input[1], input.numberOfChannels > 1 ? 1 : 0);

  engine.build(parseMaxPat(json as Parameters<typeof parseMaxPat>[0]));
  await engine.start();
  source.start(0);
  return ctx.startRendering();
}

/** 16-bit stereo WAV, the format the Max side of the comparison records. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const frames = buffer.length;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const bytes = new DataView(new ArrayBuffer(44 + frames * 4));
  const text = (at: number, s: string): void => { for (let i = 0; i < s.length; i++) bytes.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); bytes.setUint32(4, 36 + frames * 4, true); text(8, 'WAVE');
  text(12, 'fmt '); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 2, true);
  bytes.setUint32(24, buffer.sampleRate, true); bytes.setUint32(28, buffer.sampleRate * 4, true);
  bytes.setUint16(32, 4, true); bytes.setUint16(34, 16, true);
  text(36, 'data'); bytes.setUint32(40, frames * 4, true);
  const put = (at: number, v: number): void => bytes.setInt16(at, Math.round(Math.max(-1, Math.min(1, v)) * 32767), true);
  for (let i = 0; i < frames; i++) { put(44 + i * 4, left[i]); put(46 + i * 4, right[i]); }
  return new Blob([bytes], { type: 'audio/wav' });
}
