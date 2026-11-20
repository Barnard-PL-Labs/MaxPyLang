"""Leave out the black keys
zl.filter removes from a list every item that is also in the list at its right inlet. Taking 61 63 66 68 70 out of all 13 notes from 60 to 72 leaves the C major scale.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, trigger, zl_filter, zl_nth

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(1, 8))[0]
order = patch.place(trigger("b", "b", "i"))[0]
every = patch.place("message 60 61 62 63 64 65 66 67 68 69 70 71 72")[0]
black = patch.place("message 61 63 66 68 70")[0]
remove = patch.place(zl_filter)[0]
pick = patch.place(zl_nth(1))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[2], pick.ins[1]),      # 1. the position
    (order.outs[1], black.ins[0]),     # 2. the notes to remove
    (black.outs[0], remove.ins[1]),
    (order.outs[0], every.ins[0]),     # 3. the list to filter
    (every.outs[0], remove.ins[0]),
    (remove.outs[0], pick.ins[0]),     # 60 62 64 65 67 69 71 72
    (pick.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.filter")
