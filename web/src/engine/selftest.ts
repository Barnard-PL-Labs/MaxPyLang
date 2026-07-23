// Offline audio self-test: render a patch with OfflineAudioContext and measure
// the dominant frequency by counting zero-crossings. This turns "does it make
// sound?" into an automatable assertion — no human ears required.

import { parseMaxPat } from '../parser/maxpat';
import { Engine } from './engine';

export interface ToneResult {
  rms: number;         // signal energy (0 = silence)
  dominantHz: number;  // estimated fundamental from zero-crossings
}

/** Render `json` for `seconds` and analyse the left channel. */
export async function renderTone(json: unknown, seconds = 1): Promise<ToneResult> {
  const sampleRate = 44100;
  const offline = new OfflineAudioContext(2, sampleRate * seconds, sampleRate);

  const engine = new Engine(offline);
  engine.build(parseMaxPat(json));

  const buffer = await offline.startRendering();
  const data = buffer.getChannelData(0);

  let sumSq = 0;
  let crossings = 0;
  let prev = data[0];
  for (let i = 1; i < data.length; i++) {
    sumSq += data[i] * data[i];
    if ((prev <= 0 && data[i] > 0) || (prev >= 0 && data[i] < 0)) crossings++;
    prev = data[i];
  }
  const rms = Math.sqrt(sumSq / data.length);
  // Two zero-crossings per cycle; normalise crossings-per-second to Hz.
  const dominantHz = (crossings / 2) / seconds;
  return { rms, dominantHz };
}
