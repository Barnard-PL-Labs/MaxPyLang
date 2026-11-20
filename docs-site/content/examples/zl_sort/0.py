"""Put the notes in order
zl.sort sorts a list. The message box holds a scale in jumbled order; after zl.sort it plays as a rising scale. Press ▶, then set the number box to -1 to sort it falling instead.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number, trigger, zl_nth, zl_sort

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(1, 8))[0]
order = patch.place(trigger("b", "i"))[0]
jumble = patch.place("message 67 60 72 64 69 62 71 65")[0]
sort = patch.place(zl_sort)[0]
direction = patch.place(number)[0]       # -1 falling, anything else rising
pick = patch.place(zl_nth(1))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[1], pick.ins[1]),
    (order.outs[0], jumble.ins[0]),
    (jumble.outs[0], sort.ins[0]),
    (direction.outs[0], sort.ins[1]),
    (sort.outs[0], pick.ins[0]),
    (pick.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.sort")
