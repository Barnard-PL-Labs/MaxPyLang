"""Load a melody into a table
listfunnel turns a list into numbered pairs: "0 60", "1 63", "2 67" .... Each pair stores a note at that position in table, which the counter then reads back in order.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, listfunnel, loadbang, metro, mtof, table

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
tune = patch.place("message 60 63 67 70 72 70 67 63")[0]
pairs = patch.place(listfunnel)[0]
notes = patch.place(table)[0]
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(0, 7))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], tune.ins[0]),
    (tune.outs[0], pairs.ins[0]),
    (pairs.outs[0], notes.ins[0]),     # "position note" stores
    (clock.outs[0], step.ins[0]),
    (step.outs[0], notes.ins[0]),      # a position alone reads
    (notes.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("listfunnel")
