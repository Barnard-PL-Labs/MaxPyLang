"""Right to left, in order
trigger sends its input out of each outlet, right first. Here the note goes right to a delay and left to play now, so each note is followed by its octave.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, pipe, trigger

patch = mp.MaxPatch()
clock = patch.place(metro(400, active=1))[0]
step = patch.place(counter(60, 64))[0]
both = patch.place(trigger("i", "i"))[0]
later = patch.place(pipe(150))[0]
octave = patch.place("+ 12")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], both.ins[0]),
    (both.outs[0], hz.ins[0]),
    (both.outs[1], octave.ins[0]),
    (octave.outs[0], later.ins[0]),
    (later.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("trigger")
