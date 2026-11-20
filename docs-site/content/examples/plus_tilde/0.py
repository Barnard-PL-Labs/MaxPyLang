"""Mixing two tones
+~ adds signals: adding two oscillators plays them together, a fifth apart here.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
low = patch.place(cycle_tilde(220))[0]
high = patch.place(cycle_tilde(330))[0]
mix = patch.place("+~")[0]
quiet = patch.place("*~ 0.15")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (low.outs[0], mix.ins[0]),
    (high.outs[0], mix.ins[1]),
    (mix.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("plus_tilde")
