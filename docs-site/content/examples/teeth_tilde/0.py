"""A comb filter that steps down in pitch
teeth~ adds a delayed copy of its input (feedforward) and of its output (feedback) to the signal, with each delay in milliseconds. Every half second the counter sets the feedback delay to 2, 3 ... 10 ms, so the noise rings at 500 Hz, then 333 Hz, down to 100 Hz; the 1 ms feedforward copy makes it sound hollow.
"""
import maxpylang as mp
from maxpylang.objects import counter, ezdac_tilde, metro, noise_tilde, teeth_tilde

patch = mp.MaxPatch()
hiss = patch.place(noise_tilde)[0]
comb = patch.place(teeth_tilde(20, 1, 2, 0.3, 0.3, 0.9))[0]   # max ms, feedforward ms, feedback ms, gain, ff, feedback
clock = patch.place(metro(500, active=1))[0]
step = patch.place(counter(2, 10))[0]
quiet = patch.place("*~ 0.03")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (hiss.outs[0], comb.ins[0]),
    (clock.outs[0], step.ins[0]),
    (step.outs[0], comb.ins[2]),       # feedback delay, in ms
    (comb.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("teeth_tilde")
