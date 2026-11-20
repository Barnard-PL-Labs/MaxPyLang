"""Smoothing square waves
mc.rampsmooth~ turns every jump into a straight ramp over a number of samples, on each channel. 40 samples round off two square waves; type a larger number to soften them more.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_rampsmooth_tilde, mc_rect_tilde, number

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 147 220")[0]   # 2 channels
sq = patch.place(mc_rect_tilde(147))[0]
up = patch.place(number)[0]                 # samples to ramp up
smooth = patch.place(mc_rampsmooth_tilde(40, 40))[0]   # ramp up, ramp down
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], sq.ins[0]),
    (sq.outs[0], smooth.ins[0]),
    (up.outs[0], smooth.ins[1]),
    (smooth.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_rampsmooth")
