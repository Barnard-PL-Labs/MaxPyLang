"""A glide between numbers
line outputs a stream of numbers ramping to a target. "220, 880 1500" jumps to 220, then glides to 880 over 1.5 seconds, every 2 seconds.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, line, metro

patch = mp.MaxPatch()
clock = patch.place(metro(2000, active=1))[0]
glide = patch.place("message 220, 880 1500")[0]
ramp = patch.place(line)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], glide.ins[0]),
    (glide.outs[0], ramp.ins[0]),
    (ramp.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("glide")
