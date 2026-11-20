"""A switch you can see
gswitch draws which of its two data inlets reaches the outlet; a bang in its left inlet flips it. A slow metro flips it every 2 seconds, between a climbing scale and random notes.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, gswitch, metro, mtof, random

patch = mp.MaxPatch()
flipper = patch.place(metro(2000, active=1))[0]
clock = patch.place(metro(200, active=1))[0]
scale_up = patch.place(counter(60, 72))[0]
wander = patch.place(random(24))[0]
pitch = patch.place("+ 60")[0]
pick = patch.place(gswitch)[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (flipper.outs[0], pick.ins[0]), (clock.outs[0], scale_up.ins[0]),
    (clock.outs[0], wander.ins[0]), (wander.outs[0], pitch.ins[0]),
    (scale_up.outs[0], pick.ins[1]), (pitch.outs[0], pick.ins[2]), (pick.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]), (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("gswitch")
