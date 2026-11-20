"""Opening a filter
asinh (inverse hyperbolic sine) grows like a logarithm. It sets lores~'s cutoff over a 110 Hz sawtooth: from 200 Hz the sound brightens quickly, then more and more slowly up to about 3000 Hz.
"""
import maxpylang as mp
from maxpylang.objects import asinh, counter, ezdac_tilde, lores_tilde, metro, saw_tilde

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
step = patch.place(counter(0, 15))[0]
spread = patch.place("* 20")[0]
curve = patch.place(asinh)[0]          # 0 .. 5.7
width = patch.place("* 500.")[0]
cutoff = patch.place("+ 200.")[0]
saw = patch.place(saw_tilde(110))[0]
filt = patch.place(lores_tilde(200, 0.3))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], spread.ins[0]),
    (spread.outs[0], curve.ins[0]),
    (curve.outs[0], width.ins[0]),
    (width.outs[0], cutoff.ins[0]),
    (cutoff.outs[0], filt.ins[1]),
    (saw.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("asinh")
