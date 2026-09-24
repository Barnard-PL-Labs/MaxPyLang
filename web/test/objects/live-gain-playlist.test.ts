// live.gain~, playlist~ and the sample library behind playlist~.
//
// Message behaviour only — the Node suite's Web Audio is a mock. What they actually
// sound like is test/browser/sample-playback.test.ts.

import { afterEach, describe, expect, it } from 'vitest';
import '../../src/objects';
import { getFactory, isSupported } from '../../src/engine/registry';
import type { IRNode } from '../../src/ir/types';
import {
  addSampleFile,
  chooseSample,
  guessKit,
  resetSamples,
  resolveSample,
} from '../../src/objects/audio/samples';
import type { Msg } from '../../src/runtime/atoms';

const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

function irNode(className: string, raw: Record<string, unknown>, numOutlets: number): IRNode {
  return {
    id: 'obj-1', className, args: [], maxclass: className, numInlets: 2, numOutlets,
    outletDomains: [], rect: [0, 0, 150, 30], text: '', raw,
  };
}

function build(node: IRNode) {
  const built = getFactory(node.className)!(node.args, { ctx, node });
  const heard: Msg[][] = Array.from({ length: node.numOutlets }, () => []);
  heard.forEach((list, i) => built.onControlOut?.(i, (m) => list.push(m)));
  return { built, heard, send: (m: Msg) => built.controlIns?.[0]?.(m) };
}

describe('live.gain~', () => {
  const liveGain = (valueof: Record<string, unknown> = {}) =>
    build(irNode('live.gain~', { saved_attribute_attributes: { valueof } }, 5));

  it('is real, with two signal ins and outs', () => {
    expect(isSupported('live.gain~')).toBe(true);
    const { built } = liveGain();
    expect(built.signalIns.filter(Boolean)).toHaveLength(2);
    expect(built.signalOuts.slice(0, 2).filter(Boolean)).toHaveLength(2);
    expect(built.signalOuts.slice(2)).toEqual([undefined, undefined, undefined]);
  });

  it('starts at the saved initial level — the drum patch saves −70, i.e. off', () => {
    const { heard, send } = liveGain({ parameter_initial: [-70], parameter_initial_enable: 1 });
    send(['bang']);
    expect(heard[2]).toEqual([[-70]]);
    expect(heard[3]).toEqual([[0]]);
  });

  it('starts at 0 dB when no initial level is enabled', () => {
    const { heard, send } = liveGain({ parameter_initial: [-70], parameter_initial_enable: 0 });
    send(['bang']);
    expect(heard[2]).toEqual([[0]]);
  });

  it('a number sets the level, clamped to the range, and outputs dB then raw 0..1', () => {
    const { heard, send } = liveGain();
    send([-6]);
    send([20]);
    expect(heard[2]).toEqual([[-6], [6]]);
    expect(heard[3][1]).toEqual([1]);
  });

  it('set stores silently, init restores the initial level, rawfloat maps 0..1', () => {
    const { heard, send } = liveGain({ parameter_initial: [-12], parameter_initial_enable: 1 });
    send(['set', -3]);
    expect(heard[2]).toEqual([]);
    send(['outputvalue']);
    send(['init']);
    send(['rawfloat', 1]);
    expect(heard[2]).toEqual([[-3], [-12], [6]]);
  });
});

describe('playlist~', () => {
  afterEach(resetSamples);

  const clip = (filename: string, extra: Record<string, unknown> = {}) => ({ filename, ...extra });
  const playlist = (clips: unknown[], numOutlets = 4) =>
    build(irNode('playlist~', { channelcount: numOutlets - 3, data: { clips } }, numOutlets));

  it('is real, and takes its outlet layout from the saved box', () => {
    expect(isSupported('playlist~')).toBe(true);
    const mono = playlist([], 4).built; // 1 audio + sync + notifications + dict
    expect(mono.signalOuts).toHaveLength(2);
    const stereo = playlist([], 5).built; // 2 audio + sync + …
    expect(stereo.signalOuts).toHaveLength(3);
  });

  it('accepts every documented message without throwing, with or without audio', () => {
    const { send } = playlist([clip('00-tr808-clap.wav', { selection: [0.01, 0.2] }), clip('nothing.wav')]);
    for (const m of [
      [1], [2], [0], ['next'], ['pause'], ['resume'], ['selection', 1, 0.1, 0.5], ['selection', 0.1, 0.4],
      ['selectionms', 5, 170], ['selectionms', 2, 10, 100], ['setclip', 1, 'loop', 1], ['append', 'x.wav'],
      ['remove', 3], ['clear'], [1],
    ] as Msg[]) {
      expect(() => send(m)).not.toThrow();
    }
  });
});

describe('sample library', () => {
  afterEach(resetSamples);

  it('guesses a kit sample from the file name', () => {
    expect(guessKit('00-tr808-clap.wav')).toBe('clap');
    expect(guessKit('01-dance-clap.wav')).toBe('clap');
    expect(guessKit('Kick_01.aif')).toBe('kick');
    expect(guessKit('808 BD.wav')).toBe('kick');
    expect(guessKit('snare-tight.wav')).toBe('snare');
    expect(guessKit('closed_HH.wav')).toBe('hat');
    expect(guessKit('hihat.wav')).toBe('hat');
    // …and does not see drums in words that merely contain the letters.
    expect(guessKit('whatever.wav')).toBeUndefined();
    expect(guessKit('abduction.wav')).toBeUndefined();
    expect(guessKit('vocals.wav')).toBeUndefined();
  });

  it('resolves: a dropped file with the name beats the guess, and a choice beats both', () => {
    expect(resolveSample('00-tr808-clap.wav')).toEqual({ kind: 'kit', id: 'clap', guessed: true });
    addSampleFile('00-TR808-Clap.wav', new ArrayBuffer(8));
    expect(resolveSample('00-tr808-clap.wav')).toEqual({ kind: 'file', name: '00-tr808-clap.wav' });
    chooseSample('00-tr808-clap.wav', { kit: 'snare' });
    expect(resolveSample('00-tr808-clap.wav')).toEqual({ kind: 'kit', id: 'snare', guessed: false });
    chooseSample('00-tr808-clap.wav', 'none');
    expect(resolveSample('00-tr808-clap.wav')).toBeUndefined();
  });

  it('dropping the real file replaces a stand-in chosen while it was missing', () => {
    chooseSample('01-dance-clap.wav', { kit: 'snare' });
    addSampleFile('01-dance-clap.wav', new ArrayBuffer(8));
    expect(resolveSample('01-dance-clap.wav')).toEqual({ kind: 'file', name: '01-dance-clap.wav' });
  });

  it('a clip can be pointed at a file with a different name', () => {
    addSampleFile('my clap.wav', new ArrayBuffer(8));
    chooseSample('00-tr808-clap.wav', { file: 'my clap.wav' });
    expect(resolveSample('00-tr808-clap.wav')).toEqual({ kind: 'file', name: 'my clap.wav' });
  });

  it('an unguessable name with no file resolves to nothing', () => {
    expect(resolveSample('field-recording.wav')).toBeUndefined();
  });
});
