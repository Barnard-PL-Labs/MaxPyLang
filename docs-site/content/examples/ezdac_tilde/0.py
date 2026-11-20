"""Different sounds left and right
ezdac~'s left inlet is the left speaker and its right inlet the right one. 220 Hz left and 223 Hz right beat against each other three times a second.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
left = patch.place(cycle_tilde(220))[0]
right = patch.place(cycle_tilde(223))[0]
quiet_l = patch.place("*~ 0.2")[0]
quiet_r = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (left.outs[0], quiet_l.ins[0]),
    (right.outs[0], quiet_r.ins[0]),
    (quiet_l.outs[0], out.ins[0]),
    (quiet_r.outs[0], out.ins[1]),
)
patch.save("ezdac_tilde")
