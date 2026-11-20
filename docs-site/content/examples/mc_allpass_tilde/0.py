"""Clicks that ring
mc.allpass~ passes every frequency at the same level but smears sharp sounds in time. Two click tracks (2 and 3 a second) come out with a short, rattling tail.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_allpass_tilde, mc_ezdac_tilde, mc_train_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 500 333")[0]   # click period in ms
clicks = patch.place(mc_train_tilde(500, 0.01))[0]
smear = patch.place(mc_allpass_tilde(100, 23, 0.8))[0]   # max ms, delay ms, gain
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], clicks.ins[0]),
    (clicks.outs[0], smear.ins[0]),
    (smear.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_allpass")
