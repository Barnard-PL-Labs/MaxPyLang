"""Two phrases make one tune
zl.join puts the list at its right inlet on the end of the list at its left. A rising phrase and a falling phrase join into one 8-note tune.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, trigger, zl_join, zl_nth

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(1, 8))[0]
order = patch.place(trigger("b", "b", "i"))[0]
first = patch.place("message 60 64 67 72")[0]
second = patch.place("message 71 67 65 62")[0]
glue = patch.place(zl_join)[0]
pick = patch.place(zl_nth(1))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[2], pick.ins[1]),      # 1. the position
    (order.outs[1], second.ins[0]),    # 2. the end, stored at the right inlet
    (second.outs[0], glue.ins[1]),
    (order.outs[0], first.ins[0]),     # 3. the start, which sends the joined list
    (first.outs[0], glue.ins[0]),
    (glue.outs[0], pick.ins[0]),
    (pick.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.join")
