"""Wind: noise through a filter
Filtering noise gives it a pitch-like color. lores~ keeps the lows, so the hiss turns into a rumble.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, lores_tilde, noise_tilde

patch = mp.MaxPatch()
hiss = patch.place(noise_tilde)[0]
filt = patch.place(lores_tilde(400, 0.9))[0]
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (hiss.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("noise_tilde")
