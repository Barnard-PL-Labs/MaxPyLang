"""Waiting for both
buddy holds what reaches each inlet and sends everything out together only once every inlet has something. A fast metro steps a melody into the left inlet; a slow one bangs the right inlet every second, so only one note in five gets through, and the tone moves once a second.
"""
import maxpylang as mp
from maxpylang.objects import buddy, counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
fast = patch.place(metro(200, active=1))[0]
melody = patch.place(counter(60, 72))[0]
slow = patch.place(metro(1000, active=1))[0]
both = patch.place(buddy(2))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (fast.outs[0], melody.ins[0]),
    (melody.outs[0], both.ins[0]),
    (slow.outs[0], both.ins[1]),
    (both.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("buddy_sync")
