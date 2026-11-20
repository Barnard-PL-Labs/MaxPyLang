"""Shuffle, no repeats
urn 8 picks 0 to 7 at random but never the same number twice. When all 8 are used it bangs its right outlet, and "clear" refills it: each run of 8 notes plays every note of the scale once, in a new order.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, urn

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
bag = patch.place(urn(8))[0]
refill = patch.place("message clear")[0]
step = patch.place("* 2")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], bag.ins[0]),
    (bag.outs[1], refill.ins[0]),      # all used: refill
    (refill.outs[0], bag.ins[0]),
    (bag.outs[0], step.ins[0]),
    (step.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("urn")
