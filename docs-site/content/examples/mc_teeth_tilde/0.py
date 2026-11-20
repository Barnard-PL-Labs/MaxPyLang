"""A comb with two delays
mc.teeth~ is a comb filter whose feedforward and feedback delays are set apart. Here only the 2 ms feedback is used (gain 0.9), so two noise streams ring near 500 Hz.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_noise_tilde, mc_teeth_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2")[0]  # 2 channels, each its own noise
hiss = patch.place(mc_noise_tilde)[0]
comb = patch.place(mc_teeth_tilde(10, 2, 2, 0.5, 0, 0.9))[0]   # max ms, ff ms, fb ms, gain, ff gain, fb gain
quiet = patch.place("mc.*~ 0.05")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], hiss.ins[0]),
    (hiss.outs[0], comb.ins[0]),
    (comb.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_teeth")
