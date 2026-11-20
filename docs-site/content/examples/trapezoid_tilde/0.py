"""Repeating swells
trapezoid~ 0.05 0.5 reshapes phasor~'s 0..1 ramp: up to 1 by phase 0.05, held until 0.5, then down to 0 at the end. Used as volume, each third of a second starts fast and fades.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, phasor_tilde, trapezoid_tilde

patch = mp.MaxPatch()
ramp = patch.place(phasor_tilde(3))[0]                 # 0..1, three times a second
shape = patch.place(trapezoid_tilde(0.05, 0.5))[0]     # phases where it reaches 1 and leaves it
osc = patch.place(cycle_tilde(523))[0]
amp = patch.place("*~ 0.")[0]                          # times the shape
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (ramp.outs[0], shape.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (shape.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("trapezoid_tilde")
