"""Notes you can use once
offer stores pairs of numbers, an x and a y, and gives back y when it gets x; then it forgets that pair. The message box stores four notes under 0 to 3. The counter asks for them in turn: the arpeggio plays once, then offer has nothing left and the tone stays on the last note.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, loadbang, metro, mtof, offer

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
pairs = patch.place("message 0 60, 1 64, 2 67, 3 72")[0]   # x y: a note under each number
clock = patch.place(metro(500, active=1))[0]
step = patch.place(counter(0, 3))[0]
notes = patch.place(offer)[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], pairs.ins[0]),
    (pairs.outs[0], notes.ins[0]),
    (clock.outs[0], step.ins[0]),
    (step.outs[0], notes.ins[0]),
    (notes.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("offer_once")
