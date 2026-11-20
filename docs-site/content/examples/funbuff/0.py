"""Notes at a few points in time
funbuff stores y values at x positions ("0 60" stores 60 at 0). Only 0, 2, 3 and 6 are stored here: at a step with nothing stored, funbuff answers with the one stored before it, so each note holds until the next.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, funbuff, loadbang, metro, mtof, trigger

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
fill = patch.place(trigger("b", "b", "b", "b"))[0]
points = [patch.place(f"message {x} {y}")[0] for x, y in [(0, 60), (2, 67), (3, 64), (6, 72)]]
notes = patch.place(funbuff)[0]
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(0, 7))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], fill.ins[0]),
    *[(fill.outs[i], points[i].ins[0]) for i in range(4)],
    *[(p.outs[0], notes.ins[0]) for p in points],
    (clock.outs[0], step.ins[0]),
    (step.outs[0], notes.ins[0]),      # an x alone reads its y
    (notes.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("funbuff")
