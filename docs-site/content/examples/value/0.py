"""One number, shared by name
Every value with the same name ("root") shares one stored number. One value is set once at start-up; another, elsewhere, is read by each beat, so the melody is built on that root. Press ▶, then drag the number box to change the root note.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, loadbang, metro, mtof, number, trigger, value

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
first = patch.place("message 57")[0]
root = patch.place(number)[0]
store = patch.place(value("root"))[0]          # sets the shared number
clock = patch.place(metro(200, active=1))[0]
step = patch.place(counter(0, 4))[0]
order = patch.place(trigger("i", "b"))[0]      # right first: read the root, then add the step
read = patch.place(value("root"))[0]           # the same number, read here
add = patch.place("+ 0")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], first.ins[0]), (first.outs[0], store.ins[0]), (root.outs[0], store.ins[0]),
    (clock.outs[0], step.ins[0]), (step.outs[0], order.ins[0]),
    (order.outs[1], read.ins[0]), (read.outs[0], add.ins[1]),
    (order.outs[0], add.ins[0]), (add.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("value")
