"""A coloured background
panel draws a filled rectangle. It has no outlets and makes no sound; in Max you put it behind a group of objects to set them apart. Press ▶ to hear the patch beside it, a metro plucking a note.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, line_tilde, metro, panel

patch = mp.MaxPatch()
background = patch.place(panel)[0]
clock = patch.place(metro(400, active=1))[0]
shape = patch.place("message 1 5 0 300")[0]
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde(392))[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], shape.ins[0]),
    (shape.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("panel")
