"""Vibrato: one sine bends another
A slow cycle~ (5 Hz) is scaled to ±8 Hz and added to 330 Hz, then drives the pitch of a second cycle~.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde

patch = mp.MaxPatch()
lfo = patch.place(cycle_tilde(5))[0]     # 5 times a second
depth = patch.place("*~ 8")[0]           # swing ±8 Hz
center = patch.place("+~ 330")[0]        # around 330 Hz
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (lfo.outs[0], depth.ins[0]),
    (depth.outs[0], center.ins[0]),
    (center.outs[0], osc.ins[0]),       # audio into the frequency inlet
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("vibrato")
