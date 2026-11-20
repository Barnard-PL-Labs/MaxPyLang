"""A value private to this patch
pv works like value, but its name ("step") is shared only inside this patch and its subpatches, so two copies of a patch don't interfere. One pv counts; another, elsewhere, is read on each beat to choose the note.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, pv, trigger

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(0, 6))[0]
order = patch.place(trigger("b", "i"))[0]      # right first: store the step, then read it
keep = patch.place(pv("step"))[0]
read = patch.place(pv("step"))[0]
fifths = patch.place("* 7")[0]
fold = patch.place("% 12")[0]                  # fold into one octave
up = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]), (step.outs[0], order.ins[0]),
    (order.outs[1], keep.ins[0]), (order.outs[0], read.ins[0]),
    (read.outs[0], fifths.ins[0]), (fifths.outs[0], fold.ins[0]),
    (fold.outs[0], up.ins[0]), (up.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("pv")
