"""A triangle wave
tri~ sits between a sine and a square: soft, with faint odd harmonics.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, tri_tilde

patch = mp.MaxPatch()
osc = patch.place(tri_tilde(220))[0]
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("tri_tilde")
