"""Folding two waves
mc.abs~ flips the negative half of every channel upward. Two sines at 110 and 165 Hz come out an octave higher and buzzier.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_abs_tilde, mc_cycle_tilde, mc_ezdac_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 110 165")[0]   # 2 channels
osc = patch.place(mc_cycle_tilde(110))[0]
fold = patch.place(mc_abs_tilde)[0]         # adapts to 2 channels by itself
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], osc.ins[0]),
    (osc.outs[0], fold.ins[0]),
    (fold.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_abs")
