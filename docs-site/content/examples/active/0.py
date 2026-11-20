"""Playing only while the window is in front
active sends 1 when the patch window comes to the front and 0 when another window does. Here it turns the metro on and off, so the notes play only while you are looking at the patch.
"""
import maxpylang as mp
from maxpylang.objects import active, counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
front = patch.place(active)[0]
clock = patch.place(metro(300))[0]
step = patch.place(counter(60, 67))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (front.outs[0], clock.ins[0]),     # 1 starts the metro, 0 stops it
    (clock.outs[0], step.ins[0]),
    (step.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("active_window")
