"""Loop as long as the list
zl.len counts the items in a list. Sent to counter as "max 5", the count makes the loop exactly as long as the melody, so editing the message box changes the loop too.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, prepend, trigger, zl_len, zl_nth

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(1, 100))[0]
order = patch.place(trigger("b", "i"))[0]
tune = patch.place("message 60 63 67 70 72")[0]
count = patch.place(zl_len)[0]
limit = patch.place(prepend("max"))[0]  # 5 -> "max 5" sets the counter's top
pick = patch.place(zl_nth(1))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[1], pick.ins[1]),
    (order.outs[0], tune.ins[0]),
    (tune.outs[0], pick.ins[0]),
    (tune.outs[0], count.ins[0]),
    (count.outs[0], limit.ins[0]),
    (limit.outs[0], step.ins[0]),
    (pick.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.len")
