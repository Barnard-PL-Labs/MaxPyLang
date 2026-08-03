import { describe, expect, it } from 'vitest';
import '../../src/objects/audio/sampler'; // self-registers this batch only (no glob bootstrap)
import { getFactory, isSupported } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

// A real headless Web Audio mock is installed by test setup (see webaudio-mock.ts).
const ctx = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;

function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, send };
}

describe('registration', () => {
  it('registers the sampler batch as real (Tier B) factories', () => {
    for (const name of ['buffer~', 'play~', 'groove~', 'record~', 'wave~', '2d.wave~']) {
      expect(isSupported(name)).toBe(true);
    }
  });
});

describe('buffer~', () => {
  it('builds with 1 inlet and 2 control outlets (no signal outs)', () => {
    const { node } = build('buffer~', 'mybuf', 0, 1);
    expect(node.signalIns.length).toBe(1);
    expect(node.signalOuts.length).toBe(2);
    expect(node.signalOuts[0]).toBeUndefined();
    expect(node.signalOuts[1]).toBeUndefined();
    expect(typeof node.onControlOut).toBe('function');
  });

  it('provides dispose() since it owns a shared buffer', () => {
    const { node } = build('buffer~', 'disposable');
    expect(typeof node.dispose).toBe('function');
    node.dispose!();
  });
});

describe('play~', () => {
  it('builds with a signal outlet 0 and a control outlet 1', () => {
    const { node } = build('play~', 'mybuf');
    expect(node.signalOuts.length).toBe(2);
    expect(node.signalOuts[0]).toBeDefined();
    expect(node.signalOuts[1]).toBeUndefined();
    expect(typeof node.onControlOut).toBe('function');
  });

  it('reads whatever buffer buffer~ declared under the same name', () => {
    build('buffer~', 'shared', 100, 1); // declare a 100ms buffer
    const { node } = build('play~', 'shared'); // must resolve without throwing
    expect(node.signalOuts[0]).toBeDefined();
  });
});

describe('groove~', () => {
  it('builds with two signal outlets', () => {
    const { node } = build('groove~', 'mybuf');
    expect(node.signalOuts.length).toBe(2);
    expect(node.signalOuts[0]).toBeDefined();
    expect(node.signalOuts[1]).toBeDefined();
  });

  it('defaults playback rate to 1 on the signal inlet 0 param', () => {
    const { node } = build('groove~', 'mybuf');
    expect((node.signalIns[0] as AudioParam).value).toBe(1);
  });

  it('a control float into inlet 0 updates the playbackRate param .value', () => {
    const { node, send } = build('groove~', 'mybuf');
    send([1.5], 0);
    expect((node.signalIns[0] as AudioParam).value).toBe(1.5);
  });
});

describe('record~', () => {
  it('builds with 3 inlets and a single signal outlet', () => {
    const { node } = build('record~', 'mybuf');
    expect(node.signalIns.length).toBe(3);
    expect(node.signalOuts.length).toBe(1);
    expect(node.signalOuts[0]).toBeDefined();
    expect(node.signalIns[0]).toBeDefined();
  });

  it('accepts a record-arm toggle on inlet 0 without throwing', () => {
    const { send } = build('record~', 'mybuf');
    expect(() => {
      send([1], 0);
      send([0], 0);
    }).not.toThrow();
  });
});

describe('wave~ / 2d.wave~', () => {
  it('wave~ builds with 3 inlets and one signal outlet', () => {
    const { node } = build('wave~', 'mybuf');
    expect(node.signalIns.length).toBe(3);
    expect(node.signalOuts.length).toBe(1);
    expect(node.signalOuts[0]).toBeDefined();
  });

  it('2d.wave~ builds with 4 inlets and one signal outlet', () => {
    const { node } = build('2d.wave~', 'mybuf');
    expect(node.signalIns.length).toBe(4);
    expect(node.signalOuts.length).toBe(1);
    expect(node.signalOuts[0]).toBeDefined();
  });

  it('a control float into the end-point inlet does not throw', () => {
    const { send } = build('wave~', 'mybuf');
    expect(() => send([250], 2)).not.toThrow();
  });
});
