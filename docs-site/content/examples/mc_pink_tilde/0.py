"""Soft stereo rain
mc.pink~ makes one stream of pink noise per channel. Pink noise has less treble than white, so two independent channels sound like rain all around.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_pink_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2")[0]  # 2 channels, each its own noise
rain = patch.place(mc_pink_tilde)[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], rain.ins[0]),
    (rain.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_pink")
