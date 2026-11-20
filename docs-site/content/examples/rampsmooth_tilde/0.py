"""Glide between notes
counter steps through 220, 330, 440 and 550 Hz, and sig~ turns each into a signal that jumps. rampsmooth~ 4410 4410 spreads every jump over 4410 samples (0.1 s at 44.1 kHz), so cycle~ slides.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, rampsmooth_tilde, sig_tilde

patch = mp.MaxPatch()
clock = patch.place(metro(400, active=1))[0]
step = patch.place(counter(2, 5))[0]
hz = patch.place("* 110")[0]                       # 220, 330, 440, 550
jump = patch.place(sig_tilde(220))[0]
glide = patch.place(rampsmooth_tilde(4410, 4410))[0]   # ramp up, ramp down, in samples
osc = patch.place(cycle_tilde(0))[0]               # 0: the frequency comes from the signal
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], hz.ins[0]),
    (hz.outs[0], jump.ins[0]),
    (jump.outs[0], glide.ins[0]),
    (glide.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("rampsmooth_tilde")
