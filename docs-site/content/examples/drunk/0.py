"""A random walk
drunk moves a random step (up to 3) from where it was, within 0..23, so the melody wanders instead of jumping.
"""
import maxpylang as mp
from maxpylang.objects import drunk, ezdac_tilde, metro, mtof, tri_tilde

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
walk = patch.place(drunk(24, 3))[0]
shift = patch.place("+ 55")[0]
hz = patch.place(mtof)[0]
osc = patch.place(tri_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], walk.ins[0]),
    (walk.outs[0], shift.ins[0]),
    (shift.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("drunk")
