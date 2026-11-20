"""A melody that settles
mean outputs the average of every number it has received. Random notes 60..83 play in the left ear; their running mean plays in the right, wandering at first and settling near note 71.5.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, mean, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
pick = patch.place(random(24))[0]
note = patch.place("+ 60")[0]
avg = patch.place(mean)[0]
hz1 = patch.place(mtof)[0]
hz2 = patch.place(mtof)[0]
left = patch.place(cycle_tilde)[0]
right = patch.place(cycle_tilde)[0]
quiet1 = patch.place("*~ 0.2")[0]
quiet2 = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], note.ins[0]),
    (note.outs[0], hz1.ins[0]),
    (note.outs[0], avg.ins[0]),
    (avg.outs[0], hz2.ins[0]),
    (hz1.outs[0], left.ins[0]),
    (hz2.outs[0], right.ins[0]),
    (left.outs[0], quiet1.ins[0]),
    (right.outs[0], quiet2.ins[0]),
    (quiet1.outs[0], out.ins[0]),
    (quiet2.outs[0], out.ins[1]),
)
patch.save("mean")
