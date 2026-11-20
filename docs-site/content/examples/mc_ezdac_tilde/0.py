"""Stereo through one cord
mc.ezdac~ takes a multichannel cord and sends channel 1 to the left speaker and channel 2 to the right. Here a low and a high triangle wave share one cord.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_tri_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 196 784")[0]   # low left, high right
tri = patch.place(mc_tri_tilde(196))[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # one inlet for every channel

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], tri.ins[0]),
    (tri.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_ezdac")
