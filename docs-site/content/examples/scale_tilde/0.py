"""Rescaling a signal
scale~ maps a signal from one range to another. A slow sine swings from -1 to 1; scale~ turns that into 300 to 600 Hz, so the pitch of a second sine glides up and down every two seconds.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, scale_tilde

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(0.5))[0]
glide = patch.place(scale_tilde(-1, 1, 300, 600))[0]   # in low, in high, out low, out high
osc = patch.place(cycle_tilde(0))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], glide.ins[0]),
    (glide.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("scale_signal")
