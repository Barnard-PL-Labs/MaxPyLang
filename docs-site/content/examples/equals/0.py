"""Is it this beat?
== outputs 1 when its input equals its argument, otherwise 0. Beat 0 of every eight gives 1, times 12 an octave up, so the bar starts on a high note. Press ▶, then drag the number box (0..7) to move the high note to another beat.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
beat = patch.place(counter(0, 7))[0]
which = patch.place(number)[0]
match = patch.place("== 0")[0]
octave = patch.place("* 12")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], beat.ins[0]),
    (beat.outs[0], match.ins[0]),
    (which.outs[0], match.ins[1]),
    (match.outs[0], octave.ins[0]),
    (octave.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("equals")
