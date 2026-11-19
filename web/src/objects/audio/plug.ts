// plugin~ / plugout~ : a Max for Live device's audio input and output.
//
// plugin~ : two signal outlets, the left and right of the audio arriving from the track.
// plugout~ : two signal inlets, sent back to the track; its two outlets pass the same
//   signals on, as Max's do.
//
// Both attach to the host buses (runtime/host.ts) instead of to a microphone or directly
// to the speakers, so a page can play a sample through the device the way Live plays a
// clip through it. plugout~ is audible with no cord leaving it, so like ezdac~ it must
// unwire itself on dispose or a cleared patch keeps sounding.

import { register, type MaxNode } from '../../engine/registry';
import { hostBus } from '../../runtime/host';
import { unwire } from './lifecycle';

register('plugin~', (_args, { ctx }) => {
  const bus = hostBus(ctx);
  const left = new GainNode(ctx, { gain: 1 });
  const right = new GainNode(ctx, { gain: 1 });
  bus.input[0].connect(left);
  bus.input[1].connect(right);
  return {
    // The inlets exist in Max (they take signals to pass through when the device is not
    // in Live); nothing here feeds them to the outlets, so they are message-only.
    signalIns: [undefined, undefined],
    signalOuts: [left, right],
    dispose: () => {
      try { bus.input[0].disconnect(left); } catch { /* already cut */ }
      try { bus.input[1].disconnect(right); } catch { /* already cut */ }
      unwire(left);
      unwire(right);
    },
  } satisfies MaxNode;
});

register('plugout~', (_args, { ctx }) => {
  const bus = hostBus(ctx);
  const left = new GainNode(ctx, { gain: 1 });
  const right = new GainNode(ctx, { gain: 1 });
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  left.connect(merger, 0, 0);
  right.connect(merger, 0, 1);
  merger.connect(bus.output);
  return {
    signalIns: [left, right],
    signalOuts: [left, right],
    dispose: () => { unwire(merger); unwire(left); unwire(right); },
  } satisfies MaxNode;
});
