"""Big steps, then small
acosh (inverse hyperbolic cosine) takes numbers from 1 up and grows like a logarithm. For 1..16 the melody jumps up from note 55 and then climbs in ever smaller steps.
"""
import maxpylang as mp
from maxpylang.objects import acosh, counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(180, active=1))[0]
step = patch.place(counter(1, 16))[0]
curve = patch.place(acosh)[0]          # 0 .. 3.47
depth = patch.place("* 7.")[0]
note = patch.place("+ 55.")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], curve.ins[0]),
    (curve.outs[0], depth.ins[0]),
    (depth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("acosh")
