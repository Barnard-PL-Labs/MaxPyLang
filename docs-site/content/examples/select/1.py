"""sel: a rhythm from three numbers
sel is short for select. "sel 0 3 6" bangs on steps 0, 3 and 6 of an 8-step count, and each bang starts a short noise burst: the 3 + 3 + 2 rhythm.
"""
import maxpylang as mp
from maxpylang.objects import counter, ezdac_tilde, line_tilde, metro, noise_tilde

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 7))[0]
hits = patch.place("sel 0 3 6")[0]
burst = patch.place("message 1 2 0 120")[0]    # up in 2 ms, down in 120
env = patch.place(line_tilde)[0]
hiss = patch.place(noise_tilde)[0]
amp = patch.place("*~ 0.")[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]), (step.outs[0], hits.ins[0]), (hits.outs[0], burst.ins[0]),
    (hits.outs[1], burst.ins[0]), (hits.outs[2], burst.ins[0]), (burst.outs[0], env.ins[0]),
    (hiss.outs[0], amp.ins[0]), (env.outs[0], amp.ins[1]), (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("sel")
