"""Remember a number
int holds a number: the right inlet stores one quietly, a bang in the left sends it out. Each beat it sends its number, and + 1 and % 8 store the next one back: a counter, climbing a whole-tone scale.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, int_, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
hold = patch.place(int_)[0]
next_up = patch.place("+ 1")[0]
wrap = patch.place("% 8")[0]
step = patch.place("* 2")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], hold.ins[0]), (hold.outs[0], next_up.ins[0]), (next_up.outs[0], wrap.ins[0]),
    (wrap.outs[0], hold.ins[1]),       # cold: stored for the next beat, no loop
    (hold.outs[0], step.ins[0]), (step.outs[0], note.ins[0]), (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("int")
