"""Label a patch
A comment is text in the patch, for the people reading it: it has no outlets and makes no sound. This one tells you what to do with the slider beside it. Press ▶, then drag the slider as the comment says.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, scale, slider

patch = mp.MaxPatch()
note = patch.place("comment drag the slider to change the pitch")[0]
knob = patch.place(slider)[0]
hz = patch.place(scale(0, 127, 200, 800))[0]
osc = patch.place(cycle_tilde(330))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (knob.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("comment")
