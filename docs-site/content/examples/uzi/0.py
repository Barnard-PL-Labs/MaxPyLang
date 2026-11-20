"""Many bangs at once
uzi sends a burst of bangs, all in the same instant. Each beat it bangs the counter 3 times, so the note jumps 3 semitones: a diminished arpeggio. Press ▶, then type another burst size into the number box.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number, uzi

patch = mp.MaxPatch()
clock = patch.place(metro(400, active=1))[0]
size = patch.place(number)[0]
burst = patch.place(uzi(3))[0]
step = patch.place(counter(0, 11))[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], burst.ins[0]),
    (size.outs[0], burst.ins[1]),      # right inlet: how many, without firing
    (burst.outs[0], step.ins[0]),
    (step.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("uzi")
