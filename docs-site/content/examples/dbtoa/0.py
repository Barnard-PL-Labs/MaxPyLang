"""An even fade in decibels
dbtoa turns decibels into an amplitude for *~. Steps of -3 dB (0, -3 ... -36) make a fade that sounds even all the way down, then the tone starts loud again.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, dbtoa, ezdac_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
step = patch.place(counter(0, 12))[0]
db = patch.place("* -3")[0]
amp = patch.place(dbtoa)[0]
osc = patch.place(cycle_tilde(330))[0]
level = patch.place("*~ 0.")[0]      # the right inlet sets the volume
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], db.ins[0]),
    (db.outs[0], amp.ins[0]),
    (amp.outs[0], level.ins[1]),
    (osc.outs[0], level.ins[0]),
    (level.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("dbtoa")
