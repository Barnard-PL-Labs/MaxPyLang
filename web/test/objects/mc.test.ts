import { describe, expect, it } from 'vitest';
import '../../src/objects'; // full bootstrap (registers mono + mc wrappers + stubs)
import { MANIFEST, getFactory, isSupported } from '../../src/engine/registry';

const ctx = new (globalThis as unknown as {
  OfflineAudioContext: new (c: number, l: number, s: number) => BaseAudioContext;
}).OfflineAudioContext(2, 128, 44100);

describe('mc.* multichannel wrappers reuse the mono implementation', () => {
  it('marks mc.X implemented exactly when mono X is implemented', () => {
    // mono saw~/cycle~ are implemented -> their mc.* are too
    expect(isSupported('saw~')).toBe(true);
    expect(isSupported('mc.saw~')).toBe(true);
    expect(isSupported('mc.cycle~')).toBe(true);
    // a mono object that is only a stub -> its mc.* stays a stub
    if (MANIFEST['mc.biquad~'] && !isSupported('biquad~')) {
      expect(isSupported('mc.biquad~')).toBe(false);
    }
  });

  it('an mc wrapper builds and exposes its signal outlet', () => {
    const node = getFactory('mc.saw~')!([220], { ctx });
    expect(node.signalOuts[0]).toBeTruthy(); // a real audio source, like mono saw~
  });
});
