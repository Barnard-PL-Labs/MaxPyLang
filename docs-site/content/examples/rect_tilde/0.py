"""A square wave
rect~ makes a hollow, clarinet-like tone (odd harmonics only). Its second argument is the pulse width; 0.5 is a square.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, rect_tilde

patch = mp.MaxPatch()
osc = patch.place(rect_tilde(165, 0.5))[0]
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("rect_tilde")
