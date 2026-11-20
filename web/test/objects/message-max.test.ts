// The message box, as in Max: commas split it into several messages, sent in order;
// $1..$9 take the items of the message that arrived; "set" replaces the contents.
import { describe, expect, it } from 'vitest';
import '../../src/objects/control';
import { getFactory } from '../../src/engine/registry';
import { messageSegments } from '../../src/objects/control/index';
import type { Msg } from '../../src/runtime/atoms';

const ctx = new (globalThis as any).OfflineAudioContext(1, 128, 44100) as BaseAudioContext;
function build(...args: (number | string)[]) {
  const node = getFactory('message')!(args, { ctx });
  const out: Msg[] = [];
  node.onControlOut!(0, (m) => out.push(m));
  return { send: (m: Msg) => node.controlIns![0]!(m), out };
}

describe('message box', () => {
  it('splits on commas, alone or stuck to a token', () => {
    expect(messageSegments([0, '60,', 1, 64, ',', 2, '3,4'])).toEqual([[0, 60], [1, 64], [2, 3], [4]]);
  });

  it('a bang sends each comma-separated message in order', () => {
    const { send, out } = build('chans', '2,', 'applyvalues', 220, 330);
    send(['bang']);
    expect(out).toEqual([['chans', 2], ['applyvalues', 220, 330]]);
  });

  it('$1 and $2 take the items of the message that arrived', () => {
    const { send, out } = build('connect', 0, '$1', ',', 'gain', '$2');
    send([5, 0.5]);
    expect(out).toEqual([['connect', 0, 5], ['gain', 0.5]]);
  });

  it('set replaces the contents without sending', () => {
    const { send, out } = build(1, 2);
    send(['set', 7, 8]);
    expect(out).toEqual([]);
    send(['bang']);
    expect(out).toEqual([[7, 8]]);
  });
});
