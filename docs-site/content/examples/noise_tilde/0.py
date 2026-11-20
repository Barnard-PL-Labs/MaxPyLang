"""White noise
noise~ outputs random values: every frequency at equal strength, like radio static.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, noise_tilde

patch = mp.MaxPatch()
hiss = patch.place(noise_tilde)[0]
quiet = patch.place("*~ 0.1")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (hiss.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("noise_tilde")
