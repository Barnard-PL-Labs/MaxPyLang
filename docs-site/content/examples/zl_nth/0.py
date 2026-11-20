"""Play a melody stored as a list
zl.nth sends out the item at a position in a list, counting from 1. The counter steps that position from 1 to 8, so the message box plays as a tune.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, trigger, zl_nth

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(1, 8))[0]
order = patch.place(trigger("b", "i"))[0]    # right first: the position, then the list
tune = patch.place("message 60 62 64 67 69 67 64 62")[0]
pick = patch.place(zl_nth(1))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[1], pick.ins[1]),      # position (cold inlet: stored)
    (order.outs[0], tune.ins[0]),      # then bang out the list
    (tune.outs[0], pick.ins[0]),
    (pick.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.nth")
