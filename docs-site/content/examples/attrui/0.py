"""A control for one setting
attrui shows one attribute of the object it's connected to, here metro's interval, and changes it when you drag. Drag it down and the notes speed up.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
speed = patch.place("attrui @attr interval")[0]
clock = patch.place(metro(300, active=1))[0]
step = patch.place(counter(60, 72))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (speed.outs[0], clock.ins[0]),
    (clock.outs[0], step.ins[0]),
    (step.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("attrui_metro")
