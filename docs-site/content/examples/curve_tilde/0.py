"""A curved fade
curve~ is line~ with a bend: each segment is three numbers, target, time and curve. A curve of 0.8 makes the 800 ms fade drop fast, then linger.
"""
import maxpylang as mp
from maxpylang.objects import curve_tilde, ezdac_tilde, metro, tri_tilde

patch = mp.MaxPatch()
clock = patch.place(metro(1000, active=1))[0]
shape = patch.place("message 1 5 0 0 800 0.8")[0]   # triples: target, time ms, curve
env = patch.place(curve_tilde)[0]
osc = patch.place(tri_tilde(330))[0]
amp = patch.place("*~ 0.")[0]              # times the envelope (silent until it rises)
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], shape.ins[0]),
    (shape.outs[0], env.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (env.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("curve")
