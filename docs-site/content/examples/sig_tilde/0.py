"""A number as a signal
sig~ turns a number into a steady signal. Here it sets cycle~'s frequency to 262 Hz, middle C.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, sig_tilde

patch = mp.MaxPatch()
freq = patch.place(sig_tilde(262))[0]
osc = patch.place(cycle_tilde(0))[0]     # 0: the frequency comes from sig~
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (freq.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("sig_tilde")
