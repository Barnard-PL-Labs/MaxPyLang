"""A webcam theremin
jit.3m measures each frame: the minimum, mean and maximum of each plane (alpha, red, green, blue, 0 to 255), out its left, middle and right outlets. Here the mean's green value, the one that follows brightness most closely, is scaled to 150..900 Hz for cycle~. Allow camera access, press ▶, then cover the camera with your hand to lower the pitch, or turn towards a light to raise it.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, jit_3m, jit_grab, loadbang, qmetro, scale, unpack

patch = mp.MaxPatch()
start = patch.place(loadbang)[0]
open_ = patch.place("message open")[0]
clock = patch.place(qmetro(33, active=1))[0]
camera = patch.place(jit_grab)[0]
measure = patch.place(jit_3m)[0]
planes = patch.place(unpack(0., 0., 0., 0.))[0]    # alpha, red, green, blue
hz = patch.place(scale(0., 255., 150, 900))[0]
osc = patch.place(cycle_tilde(300))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (start.outs[0], open_.ins[0]),
    (open_.outs[0], camera.ins[0]),
    (clock.outs[0], camera.ins[0]),
    (camera.outs[0], measure.ins[0]),
    (measure.outs[1], planes.ins[0]),  # the mean of each plane
    (planes.outs[2], hz.ins[0]),       # green
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("jit_3m")
