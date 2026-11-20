"""Hold a moving value
line glides from 200 to 800 Hz over 4 seconds, into float's right inlet, which only stores it. A 250 ms metro bangs float to send what it holds, so the smooth glide comes out as a staircase of steps.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, float_, line, metro

patch = mp.MaxPatch()
again = patch.place(metro(4000, active=1))[0]
glide = patch.place("message 200, 800 4000")[0]
ramp = patch.place(line(0.))[0]       # a float argument: float output
clock = patch.place(metro(250, active=1))[0]
hold = patch.place(float_)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (again.outs[0], glide.ins[0]),
    (glide.outs[0], ramp.ins[0]),
    (ramp.outs[0], hold.ins[1]),       # cold: store only
    (clock.outs[0], hold.ins[0]),      # hot: bang sends it
    (hold.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("float")
