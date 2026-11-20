"""A wide, detuned sawtooth
mc.saw~ with 2 channels, 110 Hz and 110.8 Hz. Each speaker gets one, and the slight difference makes the sound spread out between them.
"""
import maxpylang as mp
from maxpylang.objects import loadbang, mc_ezdac_tilde, mc_saw_tilde

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
voices = patch.place("message chans 2, applyvalues 110 110.8")[0]   # 2 channels, slightly apart
saw = patch.place(mc_saw_tilde(110))[0]
quiet = patch.place("mc.*~ 0.15")[0]
out = patch.place(mc_ezdac_tilde)[0]        # channel 1 left, channel 2 right

patch.connect(
    (start.outs[0], voices.ins[0]),
    (voices.outs[0], saw.ins[0]),
    (saw.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
)
patch.save("mc_saw")
