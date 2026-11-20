"""Envelopes from a wavetable
mc.trapezoid~ reads a 0..1 ramp as a trapezoid: up by 0.1, flat until 0.5, then down. Fed by two ramps (1 and 1.5 Hz), it gives each tone its own repeating envelope.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_phasor_tilde, mc_trapezoid_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
rates = patch.place("message chans 2, applyvalues 1 1.5")[0]     # notes per second
pitches = patch.place("message chans 2, applyvalues 392 587")[0]
ramp = patch.place(mc_phasor_tilde(1))[0]
shape = patch.place(mc_trapezoid_tilde(0.1, 0.5))[0]   # rise ends, fall starts
osc = patch.place(mc_cycle_tilde(392))[0]
amp = patch.place("mc.*~ 0.")[0]            # tone times the envelope
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], rates.ins[0]),
    (start.outs[0], pitches.ins[0]),
    (rates.outs[0], ramp.ins[0]),
    (pitches.outs[0], osc.ins[0]),
    (ramp.outs[0], shape.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (shape.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_trapezoid")
