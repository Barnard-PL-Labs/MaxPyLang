"""A slow tremolo
cos turns an angle into a value from -1 to 1, starting at 1. Sixteen steps make one turn; times 0.5 plus 0.5 maps that to a volume from 1 down to 0 and back, so the tone fades out and in.
"""
import maxpylang as mp
from maxpylang.objects import cos, counter, cycle_tilde, ezdac_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(120, active=1))[0]
step = patch.place(counter(0, 15))[0]
angle = patch.place("* 0.3927")[0]    # 2π / 16
wave = patch.place(cos)[0]
half = patch.place("* 0.5")[0]
lift = patch.place("+ 0.5")[0]
osc = patch.place(cycle_tilde(262))[0]
level = patch.place("*~ 0.")[0]       # the right inlet sets the volume
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], angle.ins[0]),
    (angle.outs[0], wave.ins[0]),
    (wave.outs[0], half.ins[0]),
    (half.outs[0], lift.ins[0]),
    (lift.outs[0], level.ins[1]),
    (osc.outs[0], level.ins[0]),
    (level.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("cos")
