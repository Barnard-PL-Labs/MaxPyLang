"""A melody and its mirror
zl.rev reverses a list. One voice plays the scale as written while a second plays the zl.rev copy, so the two move in opposite directions.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, trigger, zl_nth, zl_rev

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(1, 8))[0]
order = patch.place(trigger("b", "i"))[0]
tune = patch.place("message 60 62 64 65 67 69 71 72")[0]
back = patch.place(zl_rev)[0]
up = patch.place(zl_nth(1))[0]
down = patch.place(zl_nth(1))[0]
hz_up, hz_down = patch.place(mtof, num_objs=2)
osc_up, osc_down = patch.place(cycle_tilde, num_objs=2)
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[1], up.ins[1]),
    (order.outs[1], down.ins[1]),
    (order.outs[0], tune.ins[0]),
    (tune.outs[0], up.ins[0]),
    (tune.outs[0], back.ins[0]),
    (back.outs[0], down.ins[0]),       # 72 71 69 ... 60
    (up.outs[0], hz_up.ins[0]),
    (down.outs[0], hz_down.ins[0]),
    (hz_up.outs[0], osc_up.ins[0]),
    (hz_down.outs[0], osc_down.ins[0]),
    (osc_up.outs[0], quiet.ins[0]),
    (osc_down.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.rev")
