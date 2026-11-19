"""Distortion by clipping
Boost a sine to 5 times its level, then clip~ cuts everything outside -0.3..0.3. The flattened peaks sound gritty.
"""
import maxpylang as mp
from maxpylang.objects import clip_tilde, cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(196))[0]
boost = patch.place("*~ 5")[0]
cut = patch.place(clip_tilde(-0.3, 0.3))[0]
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (osc.outs[0], boost.ins[0]),
    (boost.outs[0], cut.ins[0]),
    (cut.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("clip_tilde")
