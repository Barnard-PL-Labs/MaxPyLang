"""Dividing a harmonic series
div is the long name of /. Multiples of 330 Hz divided by 4. play the harmonics of 82.5 Hz, climbing from low to high. Press ▶, then drag the number box to change the divisor: a bigger number moves the whole series lower.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, number

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
step = patch.place(counter(1, 16))[0]
hz = patch.place("* 330")[0]
divisor = patch.place(number)[0]
lower = patch.place("div 4.")[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], hz.ins[0]),
    (hz.outs[0], lower.ins[0]),
    (divisor.outs[0], lower.ins[1]),   # cold inlet: used from the next note
    (lower.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("div")
