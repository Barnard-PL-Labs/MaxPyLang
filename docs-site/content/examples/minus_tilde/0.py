"""Center a ramp around zero
phasor~ ramps from 0 to 1, so its average sits at 0.5. -~ 0.5 subtracts that offset and leaves a sawtooth that swings evenly from -0.5 to 0.5.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, phasor_tilde

patch = mp.MaxPatch()
ramp = patch.place(phasor_tilde(110))[0]  # 0..1, 110 times a second
center = patch.place("-~ 0.5")[0]         # now -0.5..0.5
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (ramp.outs[0], center.ins[0]),
    (center.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("minus_tilde")
