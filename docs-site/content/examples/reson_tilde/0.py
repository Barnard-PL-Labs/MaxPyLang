"""Ringing noise
reson~ is a narrow band-pass filter. With a high Q (25) it turns white noise into a whistling tone at 880 Hz.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, noise_tilde, reson_tilde

patch = mp.MaxPatch()
hiss = patch.place(noise_tilde)[0]
ring = patch.place(reson_tilde(1, 880, 25))[0]   # gain, center Hz, Q
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (hiss.outs[0], ring.ins[0]),
    (ring.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("reson_tilde")
