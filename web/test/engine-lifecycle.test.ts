// Engine lifecycle — the contract incremental patch editing is built on.
//
// Until now a patch could only be built once into a fresh Engine and torn down by
// closing its AudioContext, which is why ▶ Run kept killing playback. Four things
// changed, and nothing else covers them:
//   • an onControlOut subscription can be undone, so one control cord can be cut from
//     a live patch without rebuilding it;
//   • build() is idempotent — a second build replaces the patch instead of stacking a
//     second copy of every object on top of the first;
//   • clear() and dispose() differ in exactly two ways: dispose() closes the context and
//     resets the process-wide runtime. Keeping the context is what preserves the user's
//     audio-unlock gesture; leaving the scheduler and the buses alone is what lets a
//     SECOND engine (the offline self-test builds one) exist without stopping the first;
//   • a rebuild of a running patch comes up running, so ▶ Run can never leave the user
//     with audible oscillators and dead timers.
//
// Two of these are only observable through node identity and teardown hooks: `built` IS
// the engine's live node map and both builds use the same box ids, so its `.size` is the
// same whether or not the previous patch was ever disposed. The assertions below are
// deliberately about which object is in the map and whose dispose() ran.
//
// Headless (Node) against test/setup/webaudio-mock.ts: these are structural/lifecycle
// assertions, never acoustic ones.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../src/objects'; // bootstrap: registers real objects + Tier-A stubs
import { Engine, edgeKey } from '../src/engine/engine';
import { MANIFEST, allClassNames, getFactory, tierOf, type MaxNode } from '../src/engine/registry';
import { makeOutlets } from '../src/runtime/outlets';
import { buses } from '../src/runtime/buses';
import { scheduler } from '../src/runtime/scheduler';
import { parseMaxPat } from '../src/parser/maxpat';
import { renderTone } from '../src/engine/selftest';
import type { Msg } from '../src/runtime/atoms';
import type { IRNode, IRPatch } from '../src/ir/types';

const OfflineCtx = (globalThis as unknown as {
  OfflineAudioContext: new (c: number, l: number, s: number) => BaseAudioContext;
}).OfflineAudioContext;
const newCtx = () => new OfflineCtx(2, 128, 44100);

function loadSample(name: string) {
  const path = fileURLToPath(new URL(`../public/test-patches/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** A minimal IRNode; the engine builds from className, not from the box geometry. */
function node(id: string, className: string, outletDomains: IRNode['outletDomains'], args: IRNode['args'] = []): IRNode {
  return {
    id, className, args, maxclass: 'newobj',
    numInlets: 1, numOutlets: outletDomains.length, outletDomains,
    rect: [0, 0, 40, 20], text: [className, ...args].join(' '),
  };
}

function patchOf(nodes: IRNode[], edges: IRPatch['edges'] = []): IRPatch {
  return { nodes, edges, byId: new Map(nodes.map((n) => [n.id, n])) };
}

/**
 * Spy on every teardown hook a node actually declares, leaving the real one in place.
 * Returned flat so a test can assert "all of these ran exactly once"; the cast is
 * because both hooks are optional on MaxNode and each node is filtered before it.
 */
function spyOnTeardown(nodes: Iterable<MaxNode>): MockInstance[] {
  const spies: MockInstance[] = [];
  for (const n of nodes) {
    if (n.stop) spies.push(vi.spyOn(n as { stop: () => void }, 'stop'));
    if (n.dispose) spies.push(vi.spyOn(n as { dispose: () => void }, 'dispose'));
  }
  return spies;
}

/** The id of the first box of a class, for patches loaded from the sample corpus. */
const idOf = (patch: IRPatch, className: string): string =>
  patch.nodes.find((n) => n.className === className)!.id;

afterEach(() => {
  // The scheduler and the named buses are process-wide singletons; a test that
  // starts a transport or a bus must not leak it into the next file.
  scheduler.clear();
  buses.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('onControlOut returns a working unsubscribe thunk', () => {
  it('the thunk silences exactly one listener and leaves the others wired', () => {
    const o = makeOutlets();
    const a: Msg[] = [];
    const b: Msg[] = [];
    const offA = o.onControlOut(0, (m) => a.push(m));
    o.onControlOut(0, (m) => b.push(m));

    o.emit(0, [1]);
    offA();
    o.emit(0, [2]);

    expect(a).toEqual([[1]]);
    expect(b).toEqual([[1], [2]]);
  });

  it('unsubscribing one of two identical subscriptions removes one delivery, not both', () => {
    // Two cords may legitimately share a callback (the same inlet handler subscribed
    // twice); removing one cord must leave the other delivering.
    const o = makeOutlets();
    let calls = 0;
    const cb = () => { calls++; };
    const off = o.onControlOut(0, cb);
    o.onControlOut(0, cb);

    o.emit(0, ['bang']);
    expect(calls).toBe(2);

    off();
    o.emit(0, ['bang']);
    expect(calls).toBe(3);
  });

  it('the thunk is idempotent and never removes a stranger', () => {
    const o = makeOutlets();
    const seen: Msg[] = [];
    const off = o.onControlOut(0, () => {});
    o.onControlOut(0, (m) => seen.push(m));

    off();
    off(); // already gone — must not splice the surviving listener out
    o.emit(0, ['bang']);

    expect(seen).toEqual([['bang']]);
  });

  it('a real control object honours the thunk mid-stream', () => {
    const counter = getFactory('counter')!([0, 99], { ctx: newCtx() });
    const kept: Msg[] = [];
    const dropped: Msg[] = [];
    counter.onControlOut!(0, (m) => kept.push(m));
    const off = counter.onControlOut!(0, (m) => dropped.push(m)) as () => void;

    counter.controlIns![0]!(['bang']);
    expect(typeof off).toBe('function');
    off();
    counter.controlIns![0]!(['bang']);

    expect(kept.map((m) => m[0])).toEqual([0, 1]);
    expect(dropped.map((m) => m[0])).toEqual([0]);
  });

  it('outlet-less and Tier-A objects still hand back a callable thunk', () => {
    // `send` speaks only over the bus and a stub never emits, but both declare
    // onControlOut, so the engine must be able to unsubscribe from them uniformly.
    const send = getFactory('send')!(['chan'], { ctx: newCtx() });
    expect(typeof send.onControlOut!(0, () => {})).toBe('function');

    const stubName = allClassNames().find(
      (n) => tierOf(n) === 'A' && MANIFEST[n].outletDomains.includes('control')
    );
    expect(stubName, 'expected at least one Tier-A object with a control outlet').toBeDefined();
    const stub = getFactory(stubName!)!([], { ctx: newCtx() });
    expect(typeof stub.onControlOut!(0, () => {})).toBe('function');
  });
});

describe('build() is idempotent', () => {
  it('replaces every object of the previous build, and tears the old ones down', () => {
    const patch = parseMaxPat(loadSample('arpeggiator.maxpat'));
    const engine = new Engine(newCtx());

    const first = engine.build(patch);
    expect(first.built.size).toBe(patch.nodes.length);
    // Snapshot the identities and hooks BEFORE the rebuild: `built` is the live map and
    // the second build overwrites it key by key, so nothing about it survives to compare.
    const before = new Map(first.built);
    const spies = spyOnTeardown(before.values());
    expect(spies.length, 'this patch must contain something with a teardown hook').toBeGreaterThan(0);

    const second = engine.build(patch);

    expect(second.built.size).toBe(patch.nodes.length);
    for (const [id, old] of before) {
      expect(second.built.get(id), `${id} was reused instead of rebuilt`).not.toBe(old);
    }
    // The failure this guards is a doubled patch: the old objects still wired to the
    // destination, still holding their timers, just no longer reachable from the map.
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('leaves nothing of the first patch running', () => {
    vi.useFakeTimers();
    const patch = parseMaxPat(loadSample('arpeggiator.maxpat'));
    const metroId = idOf(patch, 'metro');
    const engine = new Engine(newCtx());

    const first = engine.build(patch);
    const oldBangs: Msg[] = [];
    first.built.get(metroId)!.onControlOut!(0, (m) => oldBangs.push(m));
    void engine.start(); // ▶ — the offline context resolves nothing, so this is synchronous
    vi.advanceTimersByTime(700);
    const banged = oldBangs.length;
    expect(banged).toBeGreaterThan(0);

    const second = engine.build(patch);
    const newBangs: Msg[] = [];
    second.built.get(metroId)!.onControlOut!(0, (m) => newBangs.push(m));
    vi.advanceTimersByTime(700);

    expect(oldBangs.length, 'the replaced metro is still ticking').toBe(banged);
    expect(newBangs.length, 'the rebuilt patch never came back up').toBeGreaterThan(0);
  });

  it('drops the previous patch video cords instead of leaving them keyed', () => {
    const engine = new Engine(newCtx());
    const first = engine.build(parseMaxPat(loadSample('webcam_pixelated_synth.maxpat')));
    expect(first.videoCords).toBeGreaterThan(0);

    // Different box ids, so these cords land on different Map keys than the webcam
    // patch's. An entry left behind by the first build would show up as an extra cord —
    // and the frame pump would still be reading a camera nothing is displaying.
    const grab = node('v1', 'jit.grab', ['video', 'control']);
    const matrix = node('v2', 'jit.matrix', ['video', 'control']);
    const second = engine.build(
      patchOf([grab, matrix], [
        { from: { id: 'v1', outlet: 0 }, to: { id: 'v2', inlet: 0 }, domain: 'video' },
      ]),
    );
    expect(second.videoCords).toBe(1);
  });

  it('two cords into the same port collapse, because a cord is identified by its ports', () => {
    const grab = node('a', 'jit.grab', ['video', 'control']);
    const matrix = node('b', 'jit.matrix', ['video', 'control']);
    const cord = { from: { id: 'a', outlet: 0 }, to: { id: 'b', inlet: 0 }, domain: 'video' as const };
    const report = new Engine(newCtx()).build(patchOf([grab, matrix], [cord, { ...cord }]));

    expect(report.videoCords).toBe(1);
    expect(edgeKey(cord)).toBe('a:0>b:0');
  });
});

describe('clear() keeps the AudioContext, dispose() closes it', () => {
  it('clear() leaves a running context running and still buildable', async () => {
    const engine = new Engine(); // the mock AudioContext, so ctx.state is observable
    await engine.start();
    expect(engine.ctx.state).toBe('running');

    engine.clear();
    expect(engine.ctx.state).toBe('running');

    // The whole point of keeping the context: the next patch builds into it.
    const patch = parseMaxPat(loadSample('hello_world.maxpat'));
    expect(engine.build(patch).built.size).toBe(patch.nodes.length);
    expect(engine.ctx.state).toBe('running');

    await engine.dispose();
    expect(engine.ctx.state).toBe('closed');
  });

  it('clear() empties the patch without touching the context', () => {
    const engine = new Engine(newCtx());
    const patch = parseMaxPat(loadSample('hello_world.maxpat'));
    const report = engine.build(patch);
    expect(report.built.size).toBeGreaterThan(0);

    engine.clear();
    // `built` is the engine's live node map, so clearing the engine empties it.
    expect(report.built.size).toBe(0);
  });
});

describe('clear() leaves no stale named-bus subscriber', () => {
  const sendNode = node('s1', 'send', [], ['chan']);
  const recvNode = node('r1', 'receive', ['control'], ['chan']);

  it('a receive from a cleared patch stops hearing its bus', () => {
    const engine = new Engine(newCtx());
    const first = engine.build(patchOf([sendNode, recvNode]));
    // Hold the nodes themselves: clear() empties the map they came out of, and the whole
    // question is what the DISPOSED objects still do afterwards.
    const send = first.built.get('s1')!;
    const recv = first.built.get('r1')!;
    const stale: Msg[] = [];
    recv.onControlOut!(0, (m) => stale.push(m));
    send.controlIns![0]!([1]);
    expect(stale).toEqual([[1]]);

    engine.clear();
    send.controlIns![0]!([2]); // the send object still speaks to the bus; nobody listens

    // This is receive's own dispose() unsubscribing, not a bus-wide reset: clear() must
    // not touch the shared buses (see below), so per-node cleanup is the only mechanism.
    expect(stale).toEqual([[1]]);

    const second = engine.build(patchOf([sendNode, recvNode]));
    const fresh: Msg[] = [];
    second.built.get('r1')!.onControlOut!(0, (m) => fresh.push(m));
    second.built.get('s1')!.controlIns![0]!([3]);
    expect(fresh).toEqual([[3]]);
    expect(stale).toEqual([[1]]);
  });

  it('clearing one engine leaves another engine subscribed', () => {
    const live = new Engine(newCtx());
    const built = live.build(patchOf([sendNode, recvNode]));
    const heard: Msg[] = [];
    built.built.get('r1')!.onControlOut!(0, (m) => heard.push(m));

    // A second engine on the same named bus, built and torn down while the first plays.
    const other = new Engine(newCtx());
    other.build(patchOf([sendNode, recvNode]));
    other.clear();

    built.built.get('s1')!.controlIns![0]!([1]);
    expect(heard, 'the other engine unsubscribed more than its own nodes').toEqual([[1]]);
  });
});

// The engine owns its nodes, its cords and its context. It does NOT own the scheduler or
// the named buses — those are module singletons shared by every Engine in the page — and
// since build() begins with clear(), anything clear() resets is reset by merely BUILDING
// another engine. engine/selftest.ts does exactly that on every ✓ Self-test click, over
// its own OfflineAudioContext, while the player's patch is mid-arpeggio.
describe('building a second Engine leaves the first one playing', () => {
  it('the offline self-test does not stop the live transport', () => {
    vi.useFakeTimers();
    const patch = parseMaxPat(loadSample('arpeggiator.maxpat'));
    const live = new Engine(newCtx());
    const bangs: Msg[] = [];
    live.build(patch).built.get(idOf(patch, 'metro'))!.onControlOut!(0, (m) => bangs.push(m));

    void live.start();
    vi.advanceTimersByTime(700);
    const banged = bangs.length;
    expect(banged).toBeGreaterThan(0);

    // renderTone()'s exact shape: a throwaway Engine over an OfflineAudioContext.
    new Engine(newCtx()).build(parseMaxPat(loadSample('arpeggiator.maxpat')));

    expect(scheduler.isRunning, 'the self-test stopped the transport').toBe(true);
    vi.advanceTimersByTime(700);
    // Not recoverable by pressing ▶ again either: scheduler.start() re-arms the timers it
    // still holds, and a scheduler.clear() from the other engine dropped every one.
    expect(bangs.length, 'the live metro went quiet').toBeGreaterThan(banged);
  });

  it('the offline self-test does not deafen a live receive', () => {
    const live = new Engine(newCtx());
    const built = live.build(
      patchOf([node('s1', 'send', [], ['chan']), node('r1', 'receive', ['control'], ['chan'])]),
    );
    const heard: Msg[] = [];
    built.built.get('r1')!.onControlOut!(0, (m) => heard.push(m));

    new Engine(newCtx()).build(parseMaxPat(loadSample('hello_world.maxpat')));

    built.built.get('s1')!.controlIns![0]!([1]);
    expect(heard).toEqual([[1]]);
  });
});

describe('a rebuild of a running patch comes up running', () => {
  /**
   * The video pump is the only transport hook with no control-domain equivalent to watch
   * headlessly, so stub rAF for the duration: the engine is DOM-guarded and only asks for
   * a frame when it has video cords AND believes itself to be running. Callbacks are
   * collected, never invoked, so nothing recurses.
   */
  function withStubbedRaf(fn: (requests: () => number) => void): void {
    const g = globalThis as unknown as Record<string, unknown>;
    const callbacks: unknown[] = [];
    g.requestAnimationFrame = (cb: unknown) => callbacks.push(cb);
    g.cancelAnimationFrame = () => {};
    try {
      fn(() => callbacks.length);
    } finally {
      delete g.requestAnimationFrame;
      delete g.cancelAnimationFrame;
    }
  }

  const videoPatch = () =>
    patchOf(
      [node('v1', 'jit.grab', ['video', 'control']), node('v2', 'jit.matrix', ['video', 'control'])],
      [{ from: { id: 'v1', outlet: 0 }, to: { id: 'v2', inlet: 0 }, domain: 'video' }],
    );

  it('restarts the frame pump the rebuild cancelled', () => {
    withStubbedRaf((requests) => {
      const engine = new Engine(newCtx());
      engine.build(videoPatch());
      void engine.start();
      expect(requests()).toBe(1);

      // clear() cancels the pump; without the transport restore the rebuilt video chain
      // would never be pumped again, with ▶ still lit and the audio still audible.
      engine.build(videoPatch());
      expect(requests()).toBe(2);
    });
  });

  it('leaves a patch that was never started stopped', () => {
    withStubbedRaf((requests) => {
      const engine = new Engine(newCtx());
      engine.build(videoPatch());
      engine.build(videoPatch());
      expect(requests()).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------
// The ✓ Self-test button, which is the one place a SECOND engine is built on purpose.
// engine/selftest.ts renders a patch through an OfflineAudioContext — and used to walk
// away from it. A patch that is never torn down keeps whatever it registered with the
// PROCESS-WIDE runtime: metro's timer stays in the shared scheduler and keeps firing,
// and anything it feeds keeps speaking on the shared buses, forever, once per click.
// The reclaim that used to hide this was Run calling dispose(); Phase 0 changed Run to
// clear(), which deliberately leaves the shared runtime alone, so nothing reclaims it.
// ---------------------------------------------------------------------------------
describe('the offline self-test leaves nothing of its own patch behind', () => {
  /** A .maxpat with one metro feeding one `send`, so the leak is audible on a bus. */
  const metroToBus = (bus: string) => ({
    patcher: {
      boxes: [
        { box: { id: 'obj-1', maxclass: 'newobj', text: 'metro 20', numinlets: 2, numoutlets: 1, outlettype: ['bang'], patching_rect: [0, 0, 60, 22] } },
        { box: { id: 'obj-2', maxclass: 'newobj', text: `send ${bus}`, numinlets: 1, numoutlets: 0, outlettype: [], patching_rect: [0, 60, 60, 22] } },
      ],
      lines: [{ patchline: { source: ['obj-1', 0], destination: ['obj-2', 0] } }],
    },
  });

  it('a rendered patch stops ticking, and stops speaking on the shared bus', async () => {
    vi.useFakeTimers();
    // The live patch: a `receive` the user can hear, on a transport that is running.
    const live = new Engine(newCtx());
    const built = live.build(patchOf([node('r1', 'receive', ['control'], ['zz'])]));
    const heard: Msg[] = [];
    built.built.get('r1')!.onControlOut!(0, (m) => heard.push(m));
    void live.start();
    expect(scheduler.isRunning).toBe(true);

    // ✓ Self-test. The offline context resolves immediately under the mock.
    await renderTone(metroToBus('zz'), 1);
    vi.advanceTimersByTime(500);

    // 25 phantom bangs in half a second, and they never stop: the metro is armed
    // because the shared transport is running, and nothing holds a canceller for it.
    expect(heard, 'the self-test patch is still ticking into the live patch').toEqual([]);
    // …and the live patch is untouched: clear() must not reach the shared scheduler.
    expect(scheduler.isRunning, 'the self-test stopped the live transport').toBe(true);
  });

  it('still returns a real measurement', async () => {
    // The teardown must not happen before the render is read.
    const result = await renderTone(metroToBus('other'), 1);
    expect(result.rms).toBeTypeOf('number');
    expect(Number.isFinite(result.dominantHz)).toBe(true);
  });
});
