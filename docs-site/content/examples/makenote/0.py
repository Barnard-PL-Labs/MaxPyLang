"""Notes with a length
makenote pairs each pitch with a velocity (100) and sends a matching note-off (velocity 0) 200 ms later. Divided by 127, the velocity drives adsr~: up to start the note, 0 to end it.
"""
import maxpylang as mp
from maxpylang.objects import adsr_tilde, cycle_tilde, ezdac_tilde, makenote, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(400, active=1))[0]
pick = patch.place(random(12))[0]
shift = patch.place("+ 60")[0]
notes = patch.place(makenote(100, 200))[0]   # velocity, duration ms
hz = patch.place(mtof)[0]
level = patch.place("/ 127.")[0]             # velocity 0..127 -> 0..1
env = patch.place(adsr_tilde(5, 80, 0.6, 150))[0]
osc = patch.place(cycle_tilde)[0]
amp = patch.place("*~ 0.")[0]              # times the envelope (silent until it rises)
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], shift.ins[0]),
    (shift.outs[0], notes.ins[0]),
    (notes.outs[0], hz.ins[0]),        # pitch
    (notes.outs[1], level.ins[0]),     # velocity
    (hz.outs[0], osc.ins[0]),
    (level.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("makenote")
