"""Slowing the jumps
mc.deltaclip~ limits how far each channel may move from one sample to the next. Two square waves can't jump, so their edges become slopes and the sound turns soft.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_deltaclip_tilde, mc_ezdac_tilde, mc_rect_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 110 165")[0]   # 2 channels
sq = patch.place(mc_rect_tilde(110))[0]
slope = patch.place(mc_deltaclip_tilde(-0.01, 0.01))[0]   # most change per sample, down and up
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], sq.ins[0]),
    (sq.outs[0], slope.ins[0]),
    (slope.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_deltaclip")
