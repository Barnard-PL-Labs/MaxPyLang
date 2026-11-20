"""Hearing the decibel curve
atodb turns an amplitude (0..1) into decibels. Amplitudes 1/16 .. 16/16 become -24 .. 0 dB, played as notes 60..84: the pitch jumps up at first and creeps at the end, because decibels are logarithmic.
"""
import maxpylang as mp
from maxpylang.objects import atodb, counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(180, active=1))[0]
step = patch.place(counter(1, 16))[0]
amp = patch.place("/ 16.")[0]
db = patch.place(atodb)[0]
note = patch.place("+ 84.")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], amp.ins[0]),
    (amp.outs[0], db.ins[0]),
    (db.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("atodb")
