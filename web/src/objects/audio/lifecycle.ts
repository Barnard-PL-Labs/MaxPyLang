// How a signal object stops making sound when its box goes away.
//
// Engine.clear() cuts every cord and then calls each node's dispose(), and for most
// audio objects cutting the cord is enough — a GainNode or a BiquadFilterNode with
// nothing connected to it is silent and collectable. The exceptions are the two shapes
// that are alive on their own:
//
//   • a SCHEDULED SOURCE (OscillatorNode, ConstantSourceNode, AudioBufferSourceNode)
//     keeps running after .start() whether or not anyone is listening, so it costs CPU
//     for the life of the context unless it is stopped;
//   • a SINK wired to ctx.destination (ezdac~) is audible without any cord into the
//     engine at all, so it has to unwire itself.
//
// Both are one line each and both were missing, which is why a cleared patch used to
// keep playing. This module exists so that line reads the same in every factory and so
// the "stop() may legitimately throw" rule is stated once rather than eight times.

/**
 * Stop a source and unwire it. Safe to call twice, and safe on a context that has
 * already finished rendering or closed — stop() throws InvalidStateError in both cases,
 * and a teardown path that threw would leave the REST of the patch wired.
 */
export function stopSource(node: AudioScheduledSourceNode): void {
  try {
    node.stop();
  } catch {
    /* never started, already stopped, or the context is gone */
  }
  try {
    node.disconnect();
  } catch {
    /* nothing was connected */
  }
}

/** Unwire a node from everything it feeds. Never throws; see stopSource. */
export function unwire(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    /* nothing was connected */
  }
}
