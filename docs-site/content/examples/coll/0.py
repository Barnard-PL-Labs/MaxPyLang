"""Step through a stored melody
coll stores a message at each address, and "next" sends out the next one, going back to the first after the last. listfunnel loads the melody as "0 67", "1 64" ... and the clock sends "next".
"""
import maxpylang as mp
from maxpylang.objects import coll, cycle_tilde, ezdac_tilde, listfunnel, loadbang, metro, mtof

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
tune = patch.place("message 67 64 60 64 67 72 71 67")[0]
pairs = patch.place(listfunnel)[0]       # "address note" stores it
notes = patch.place(coll)[0]
clock = patch.place(metro(250, active=1))[0]
advance = patch.place("message next")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], tune.ins[0]),
    (tune.outs[0], pairs.ins[0]),
    (pairs.outs[0], notes.ins[0]),
    (clock.outs[0], advance.ins[0]),
    (advance.outs[0], notes.ins[0]),
    (notes.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("coll")
