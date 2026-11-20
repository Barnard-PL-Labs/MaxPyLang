"""Two halves of a bar
< outputs 1 while its input is less than its argument. Counting 0..7, < 4 is 1 for the first four beats and 0 for the rest, so the bar plays note 65 four times and then 60 four times.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
beat = patch.place(counter(0, 7))[0]
early = patch.place("< 4")[0]
fourth = patch.place("* 5")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], beat.ins[0]),
    (beat.outs[0], early.ins[0]),
    (early.outs[0], fourth.ins[0]),
    (fourth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("lessthan")
