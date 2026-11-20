"""Slow a fast stream down
The counter climbs a semitone every 30 ms, too fast to hear as notes. speedlim lets at most one number through every 250 ms, so you hear a few steps of the climb. Press ▶, then type a new limit (ms) into the number box.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number, speedlim

patch = mp.MaxPatch()
clock = patch.place(metro(30, active=1))[0]
climb = patch.place(counter(48, 84))[0]
limit = patch.place(number)[0]
slow = patch.place(speedlim(250))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], climb.ins[0]),
    (climb.outs[0], slow.ins[0]),
    (limit.outs[0], slow.ins[1]),
    (slow.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("speedlim")
