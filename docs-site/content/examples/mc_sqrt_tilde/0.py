"""Ramps that rise fast
mc.sqrt~ takes the square root of every channel. Two 0..1 ramps from mc.phasor~ (1 and 1.5 Hz) bend into quick swells that shape two tones.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_phasor_tilde, mc_sqrt_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
rates = patch.place("message chans 2, applyvalues 1 1.5")[0]     # swells per second
pitches = patch.place("message chans 2, applyvalues 330 495")[0]
ramp = patch.place(mc_phasor_tilde(1))[0]
bend = patch.place(mc_sqrt_tilde)[0]        # 0.25 becomes 0.5: early values grow
osc = patch.place(mc_cycle_tilde(330))[0]
amp = patch.place("mc.*~ 0.")[0]            # tone times the bent ramp
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], rates.ins[0]),
    (start.outs[0], pitches.ins[0]),
    (rates.outs[0], ramp.ins[0]),
    (pitches.outs[0], osc.ins[0]),
    (ramp.outs[0], bend.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (bend.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_sqrt")
