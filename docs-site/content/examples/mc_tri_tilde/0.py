"""A number goes to every channel
mc.tri~ starts as two triangle waves, 262 and 392 Hz. A plain number sent to an mc object reaches every channel: type a frequency in the number box and both voices jump to it.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_tri_tilde, number

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 262 392")[0]   # 2 channels, a fifth apart
pitch = patch.place(number)[0]              # try 300: both channels play it
tri = patch.place(mc_tri_tilde(262))[0]
quiet = patch.place("mc.*~ 0.2")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], tri.ins[0]),
    (pitch.outs[0], tri.ins[0]),
    (tri.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_tri")
