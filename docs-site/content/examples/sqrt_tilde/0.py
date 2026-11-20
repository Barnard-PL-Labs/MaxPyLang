"""Equal-power panning
A slow sine moves a position p from 0 to 1. sqrt~ of p sets the right speaker and sqrt~ of 1 - p the left, so the tone glides across without dipping in the middle.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, sqrt_tilde

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(0.25))[0]   # once every 4 seconds
span = patch.place("*~ 0.5")[0]
pos = patch.place("+~ 0.5")[0]            # p: 0 = left, 1 = right
other = patch.place("!-~ 1")[0]           # 1 - p
right = patch.place(sqrt_tilde)[0]
left = patch.place(sqrt_tilde)[0]
osc = patch.place(cycle_tilde(440))[0]
quiet = patch.place("*~ 0.2")[0]
amp_l = patch.place("*~ 0.")[0]
amp_r = patch.place("*~ 0.")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], span.ins[0]), (span.outs[0], pos.ins[0]),
    (pos.outs[0], right.ins[0]), (pos.outs[0], other.ins[0]), (other.outs[0], left.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], amp_l.ins[0]), (left.outs[0], amp_l.ins[1]),
    (quiet.outs[0], amp_r.ins[0]), (right.outs[0], amp_r.ins[1]),
    (amp_l.outs[0], out.ins[0]),
    (amp_r.outs[0], out.ins[1]),
)
patch.save("sqrt_tilde")
