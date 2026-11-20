"""Snapping to a grid
round rounds to the nearest multiple of its argument. A chromatic climb 0..23 rounded to multiples of 3 becomes a staircase of minor thirds above note 60. Press ▶, then drag the number box to change the step: 1 is chromatic, 4 major thirds, 7 fifths.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number, round_

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 23))[0]
grid = patch.place(number)[0]
snap = patch.place(round_(3))[0]
up = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], snap.ins[0]),
    (grid.outs[0], snap.ins[1]),
    (snap.outs[0], up.ins[0]),
    (up.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("round")
