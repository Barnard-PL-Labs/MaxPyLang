"""Click to pluck
A button sends a bang when clicked, and flashes whenever a bang passes through it. Here metro bangs it twice a second and each bang plucks a note. Press ▶ to watch it flash, then click the button to add notes of your own.
"""
import maxpylang as mp
from maxpylang.objects import button, cycle_tilde, ezdac_tilde, line_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(500, active=1))[0]
hit = patch.place(button)[0]
shape = patch.place("message 1 5 0 300")[0]
env = patch.place(line_tilde)[0]
osc = patch.place(cycle_tilde(440))[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], hit.ins[0]),
    (hit.outs[0], shape.ins[0]),
    (shape.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("button")
