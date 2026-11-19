// The host: what stands in for Ableton Live around a Max for Live device.
//
// A device does not own its audio. plugin~ receives whatever the track is playing and
// plugout~ hands the result back to the track's mixer. In a browser there is no track,
// so a page that wants to audition a device plays a sound INTO the host input and
// listens to the host output. This module is that pair of buses, one per AudioContext.
//
// The buses outlive any one build of the patch on purpose. Engine.build() tears every
// object down and makes new ones, and a page auditioning a device rebuilds it on every
// settings change; the sample that is playing must not restart because a filter was
// toggled. So the page connects to the buses once, and each new plugin~ / plugout~
// attaches itself to them as it is constructed.
//
// With nothing feeding the input (the patcher at /app/, a self-test) plugin~ is silent,
// which is what it is in Max with no audio coming down the track.

export interface HostBus {
  /** Left and right of what the "track" is playing. Connect a source here. */
  readonly input: readonly [GainNode, GainNode];
  /** The device's stereo output. Connected to the speakers until a page takes it over. */
  readonly output: GainNode;
}

const buses = new WeakMap<BaseAudioContext, HostBus>();

export function hostBus(ctx: BaseAudioContext): HostBus {
  let bus = buses.get(ctx);
  if (!bus) {
    const output = new GainNode(ctx, { gain: 1 });
    output.connect(ctx.destination);
    bus = {
      input: [new GainNode(ctx, { gain: 1 }), new GainNode(ctx, { gain: 1 })],
      output,
    };
    buses.set(ctx, bus);
  }
  return bus;
}
