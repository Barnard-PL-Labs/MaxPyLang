"""Let go of every held note
flush remembers each note-on that passes through it. These notes never get a note-off, so the tone never stops; every 2.25 seconds a bang makes flush send a note-off (velocity 0) for each, and the tone drops out until the next note.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, flush, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(500, active=1))[0]
release = patch.place(metro(2250, active=1))[0]
step = patch.place(counter(60, 64))[0]
note_on = patch.place("t i 100")[0]   # velocity first (right), then the pitch
held = patch.place(flush)[0]
hz = patch.place(mtof)[0]
level = patch.place("/ 127.")[0]
osc = patch.place(cycle_tilde)[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]), (step.outs[0], note_on.ins[0]),
    (note_on.outs[1], held.ins[1]), (note_on.outs[0], held.ins[0]),
    (release.outs[0], held.ins[0]),
    (held.outs[0], hz.ins[0]), (hz.outs[0], osc.ins[0]),
    (held.outs[1], level.ins[0]), (level.outs[0], amp.ins[1]),
    (osc.outs[0], amp.ins[0]),
    (amp.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("flush")
