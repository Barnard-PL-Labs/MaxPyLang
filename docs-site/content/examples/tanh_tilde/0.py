"""Soft saturation
tanh~ squeezes a signal smoothly into -1..1: quiet parts pass almost unchanged, loud parts round off, like tape or a tube. A sine boosted 4 times comes out warm and slightly square. Press ▶, then drag the number box to change the boost.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, number, tanh_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(147))[0]
boost = patch.place("*~ 4")[0]              # 4 times louder, until you change the number
amount = patch.place(number)[0]
soft = patch.place(tanh_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (osc.outs[0], boost.ins[0]),
    (amount.outs[0], boost.ins[1]),
    (boost.outs[0], soft.ins[0]),
    (soft.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("tanh")
