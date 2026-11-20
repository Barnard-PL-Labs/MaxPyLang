"""A scale from its steps
zl.sum adds up a list. The message box holds the steps of a major scale; zl.slice keeps the first 1 to 8 of them, and their sum above 60 climbs the C major scale.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, trigger, zl_slice, zl_sum

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(1, 8))[0]
order = patch.place(trigger("b", "i"))[0]
steps = patch.place("message 0 2 2 1 2 2 2 1")[0]   # semitones between scale notes
first = patch.place(zl_slice(1))[0]
total = patch.place(zl_sum)[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], order.ins[0]),
    (order.outs[1], first.ins[1]),     # how many steps to keep
    (order.outs[0], steps.ins[0]),
    (steps.outs[0], first.ins[0]),
    (first.outs[0], total.ins[0]),
    (total.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.sum")
