"""Stereo noise from one box
mc.noise~ with 2 channels makes two separate streams of white noise, not one copy, so the hiss sounds wide instead of sitting in the middle.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_noise_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2")[0]  # 2 channels, each its own noise
hiss = patch.place(mc_noise_tilde)[0]
quiet = patch.place("mc.*~ 0.1")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], hiss.ins[0]),
    (hiss.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_noise")
