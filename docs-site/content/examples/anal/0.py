"""Count how often a step repeats
anal reports each pair of numbers in a row, with how many times that pair has come so far: "previous current count". The counter loops 0 1 2 3, so every pair comes once more each round, and the count, played as pitch, climbs a step each round.
"""
import maxpylang as mp
from maxpylang.objects import anal, counter, cycle_tilde, ezdac_tilde, metro, mtof, zl_nth

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
step = patch.place(counter(0, 3))[0]
pairs = patch.place(anal)[0]
count = patch.place(zl_nth(3))[0]        # the third item: the count
higher = patch.place("* 2")[0]
note = patch.place("+ 58")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], pairs.ins[0]),
    (pairs.outs[0], count.ins[0]),
    (count.outs[0], higher.ins[0]),
    (higher.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("anal")
