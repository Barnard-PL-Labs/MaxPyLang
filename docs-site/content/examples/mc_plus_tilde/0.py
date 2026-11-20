"""Vibrato on every channel
mc.+~ (mc.plus~) adds to each channel. Two slow sines, 4 and 6 Hz, are scaled to ±15 and then raised to 330, so each of two tones wavers around 330 Hz at its own speed.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_cycle_tilde, mc_ezdac_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
speeds = patch.place("message chans 2, applyvalues 4 6")[0]
lfo = patch.place(mc_cycle_tilde(4))[0]
depth = patch.place("mc.*~ 15")[0]
centre = patch.place("mc.+~ 330")[0]
osc = patch.place(mc_cycle_tilde(0))[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]

patch.connect(
    (start.outs[0], speeds.ins[0]),
    (speeds.outs[0], lfo.ins[0]),
    (lfo.outs[0], depth.ins[0]),
    (depth.outs[0], centre.ins[0]),
    (centre.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_plus")
