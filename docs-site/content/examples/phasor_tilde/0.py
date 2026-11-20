"""A ramp from 0 to 1
phasor~ ramps from 0 to 1 and jumps back, 220 times a second. Scaling it to -1..1 makes it audible as a sawtooth.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, phasor_tilde

patch = mp.MaxPatch()
ramp = patch.place(phasor_tilde(220))[0]
wide = patch.place("*~ 2")[0]          # 0..1 -> 0..2
center = patch.place("-~ 1")[0]        # 0..2 -> -1..1
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (ramp.outs[0], wide.ins[0]),
    (wide.outs[0], center.ins[0]),
    (center.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("phasor_tilde")
