"""Watching a multichannel signal
mc.number~ displays the value of one channel of a multichannel signal at a time. Two slow ramps from mc.phasor~ also shape two tones, so you hear what the box shows.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde, mc_number_tilde, mc_phasor_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
rates = patch.place("message chans 2, applyvalues 0.5 0.75")[0]  # slow rising ramps
pitches = patch.place("message chans 2, applyvalues 262 330")[0]
ramp = patch.place(mc_phasor_tilde(0.5))[0]
watch = patch.place(mc_number_tilde)[0]     # shows the ramp, 0..1
osc = patch.place(mc_cycle_tilde(262))[0]
amp = patch.place("mc.*~ 0.")[0]            # tone times the ramp
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], rates.ins[0]),
    (start.outs[0], pitches.ins[0]),
    (rates.outs[0], ramp.ins[0]),
    (pitches.outs[0], osc.ins[0]),
    (ramp.outs[0], watch.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (ramp.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_number")
