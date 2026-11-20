"""Stretch an interval
rslider selects a range and sends both ends: the low end from its left outlet, the high end from its right. Each end sets the pitch of one cycle~, so the two notes are the range. Press ▶, then drag either end of the rslider to pull the notes apart or together.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, mtof, rslider, scale

patch = mp.MaxPatch()
ends = patch.place(rslider)[0]
low = patch.place(scale(0, 127, 48, 72))[0]    # 0..127 -> MIDI notes C3..C5
high = patch.place(scale(0, 127, 48, 72))[0]
low_hz = patch.place(mtof)[0]
high_hz = patch.place(mtof)[0]
osc_low = patch.place(cycle_tilde(220))[0]
osc_high = patch.place(cycle_tilde(330))[0]    # a fifth above, until you drag
quiet = patch.place("*~ 0.1")[0]           # two tones add up: keep each quieter
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (ends.outs[0], low.ins[0]),
    (ends.outs[1], high.ins[0]),
    (low.outs[0], low_hz.ins[0]),
    (high.outs[0], high_hz.ins[0]),
    (low_hz.outs[0], osc_low.ins[0]),
    (high_hz.outs[0], osc_high.ins[0]),
    (osc_low.outs[0], quiet.ins[0]),
    (osc_high.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("rslider")
