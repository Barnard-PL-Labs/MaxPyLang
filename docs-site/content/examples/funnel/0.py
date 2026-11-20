"""Which clock was that?
funnel sends everything out of one outlet, with the number of the inlet it came in on in front. Two clocks share one oscillator: the inlet number picks C for the left clock and G for the right.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, funnel, metro, mtof, unpack

patch = mp.MaxPatch()
left = patch.place(metro(500, active=1))[0]
right = patch.place(metro(300, active=1))[0]
merge = patch.place(funnel(2))[0]        # a bang in inlet 1 -> "1 0"
split = patch.place(unpack(0, 0))[0]
fifth = patch.place("* 7")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (left.outs[0], merge.ins[0]),
    (right.outs[0], merge.ins[1]),
    (merge.outs[0], split.ins[0]),
    (split.outs[0], fifth.ins[0]),     # the inlet number: 0 or 1
    (fifth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("funnel")
