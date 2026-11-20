"""A metallic comb filter
comb~ adds a delayed copy of the signal to itself. A 5 ms delay with feedback (0.9) gives noise a pitch near 200 Hz.
"""
import maxpylang as mp
from maxpylang.objects import comb_tilde, ezdac_tilde, noise_tilde

patch = mp.MaxPatch()
hiss = patch.place(noise_tilde)[0]
comb = patch.place(comb_tilde(50, 5, 0.3, 0, 0.9))[0]   # max ms, delay ms, gain, ff, feedback
quiet = patch.place("*~ 0.05")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (hiss.outs[0], comb.ins[0]),
    (comb.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("comb_tilde")
