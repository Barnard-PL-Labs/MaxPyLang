"""Brighter at the end of the phrase
greaterthan is the long name of >. Counting 0..15, greaterthan 11 is 1 for the last four steps, which opens lores~ from 300 to 2300 Hz: the buzzy sawtooth turns bright, then dark again.
"""
import maxpylang as mp
from maxpylang.objects import counter, ezdac_tilde, lores_tilde, metro, saw_tilde

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 15))[0]
late = patch.place("greaterthan 11")[0]
open_ = patch.place("* 2000")[0]
cutoff = patch.place("+ 300")[0]
saw = patch.place(saw_tilde(110))[0]
filt = patch.place(lores_tilde(300, 0.3))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], late.ins[0]),
    (late.outs[0], open_.ins[0]),
    (open_.outs[0], cutoff.ins[0]),
    (cutoff.outs[0], filt.ins[1]),
    (saw.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("greaterthan")
