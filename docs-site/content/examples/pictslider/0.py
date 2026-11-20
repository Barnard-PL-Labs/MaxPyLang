"""Two controls in one
pictslider moves in two directions at once: left-right is sent from its left outlet, up-down from its right, each 0..127. Here left-right sets the pitch of saw~ and up-down the cutoff of lores~. Press ▶, then move the pictslider's two controls.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, lores_tilde, pictslider, saw_tilde, scale

patch = mp.MaxPatch()
pad = patch.place(pictslider)[0]
pitch = patch.place(scale(0, 127, 55, 220))[0]
bright = patch.place(scale(0, 127, 200, 4000))[0]
saw = patch.place(saw_tilde(110))[0]
filt = patch.place(lores_tilde(800, 0.7))[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (pad.outs[0], pitch.ins[0]),
    (pad.outs[1], bright.ins[0]),
    (pitch.outs[0], saw.ins[0]),
    (bright.outs[0], filt.ins[1]),
    (saw.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("pictslider")
