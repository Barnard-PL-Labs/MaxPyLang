"""Keep adding
accum's middle inlet adds to the number it holds; a bang in the left inlet outputs it. Each beat adds 7 semitones, then sends the total: % 12 folds it into one octave, so the notes walk the circle of fifths.
"""
import maxpylang as mp
from maxpylang.objects import accum, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
order = patch.place("t b b")[0]
fifth = patch.place("message 7")[0]
total = patch.place(accum(0))[0]
fold = patch.place("% 12")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], order.ins[0]),
    (order.outs[1], fifth.ins[0]),     # right first: add 7
    (fifth.outs[0], total.ins[1]),
    (order.outs[0], total.ins[0]),     # then output the total
    (total.outs[0], fold.ins[0]), (fold.outs[0], note.ins[0]), (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("accum")
