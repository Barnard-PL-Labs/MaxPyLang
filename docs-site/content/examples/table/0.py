"""A melody in a table
table holds a row of numbers: "set 0 60 63 ..." writes them from position 0 on, and a position at the left inlet reads one back. The counter reads positions 0 to 7, which plays the row as a tune.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, loadbang, metro, mtof, table

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
fill = patch.place("message set 0 60 63 65 67 70 67 65 63")[0]
notes = patch.place(table)[0]
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(0, 7))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], fill.ins[0]),
    (fill.outs[0], notes.ins[0]),
    (clock.outs[0], step.ins[0]),
    (step.outs[0], notes.ins[0]),
    (notes.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("table")
