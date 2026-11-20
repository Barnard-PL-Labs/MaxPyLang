"""Split a list into two voices
zl.slice 4 sends the first 4 items out of its left outlet and the rest out of its right. The low half and the high half of the list play together as two voices.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, trigger, zl_nth, zl_slice

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(1, 4))[0]
order = patch.place(trigger("b", "i"))[0]
both = patch.place("message 48 53 55 52 64 65 67 64")[0]
split = patch.place(zl_slice(4))[0]
low = patch.place(zl_nth(1))[0]
high = patch.place(zl_nth(1))[0]
hz_low, hz_high = patch.place(mtof, num_objs=2)
osc_low, osc_high = patch.place(cycle_tilde, num_objs=2)
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[1], low.ins[1]),
    (order.outs[1], high.ins[1]),
    (order.outs[0], both.ins[0]),
    (both.outs[0], split.ins[0]),
    (split.outs[0], low.ins[0]),       # 48 53 55 52
    (split.outs[1], high.ins[0]),      # 64 65 67 64
    (low.outs[0], hz_low.ins[0]),
    (high.outs[0], hz_high.ins[0]),
    (hz_low.outs[0], osc_low.ins[0]),
    (hz_high.outs[0], osc_high.ins[0]),
    (osc_low.outs[0], quiet.ins[0]),
    (osc_high.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.slice")
