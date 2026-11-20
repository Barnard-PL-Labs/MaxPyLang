"""Wrapping a count into a loop
% gives the remainder after dividing. A counter climbing 0..59, % 5 becomes 0 1 2 3 4 0 1 2 ..., a five-note whole-tone loop. Press ▶, then drag the number box to change the loop length.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number

patch = mp.MaxPatch()
clock = patch.place(metro(180, active=1))[0]
step = patch.place(counter(0, 59))[0]
length = patch.place(number)[0]
wrap = patch.place("% 5")[0]
tone = patch.place("* 2")[0]
up = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], wrap.ins[0]),
    (length.outs[0], wrap.ins[1]),
    (wrap.outs[0], tone.ins[0]),
    (tone.outs[0], up.ins[0]),
    (up.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("modulo")
