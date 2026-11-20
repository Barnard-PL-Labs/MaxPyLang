"""Lows left, highs right
cross~ splits a sawtooth at 800 Hz: the left outlet carries what is below, to the left speaker, and the right outlet what is above, to the right. Press ▶, then drag the dial to move the split from 200 to 4000 Hz.
"""
import maxpylang as mp
from maxpylang.objects import cross_tilde, dial, ezdac_tilde, saw_tilde, scale

patch = mp.MaxPatch()
knob = patch.place(dial)[0]
hz = patch.place(scale(0, 127, 200, 4000))[0]
saw = patch.place(saw_tilde(110))[0]
split = patch.place(cross_tilde(800))[0]   # 800 Hz until you move the dial
low = patch.place("*~ 0.2")[0]
high = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (knob.outs[0], hz.ins[0]),
    (hz.outs[0], split.ins[1]),
    (saw.outs[0], split.ins[0]),
    (split.outs[0], low.ins[0]),
    (split.outs[1], high.ins[0]),
    (low.outs[0], out.ins[0]),
    (high.outs[0], out.ins[1]),
)
patch.save("cross_tilde")
