"""Turn a rising ramp into plucks
!-~ 1 outputs 1 minus its input, so phasor~'s rising ramp becomes a falling one. As a volume envelope that is a sharp attack and a fade, twice a second.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, phasor_tilde

patch = mp.MaxPatch()
ramp = patch.place(phasor_tilde(2))[0]    # 0 up to 1, twice a second
fall = patch.place("!-~ 1")[0]            # 1 - ramp: 1 down to 0
osc = patch.place(cycle_tilde(392))[0]
amp = patch.place("*~ 0.")[0]             # times the envelope
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (ramp.outs[0], fall.ins[0]),
    (osc.outs[0], amp.ins[0]),
    (fall.outs[0], amp.ins[1]),
    (amp.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("rminus_tilde")
