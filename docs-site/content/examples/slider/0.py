"""Drag to change the pitch
A slider sends 0..127 as you drag it. scale maps that onto 200..1000 Hz for cycle~. Press ▶, then drag the slider in the patch.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, scale, slider

patch = mp.MaxPatch()
knob = patch.place(slider)[0]
hz = patch.place(scale(0, 127, 200, 1000))[0]
osc = patch.place(cycle_tilde(330))[0]     # 330 Hz until you move the slider
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (knob.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("slider")
