"""Turn a dial to open a filter
A dial sends 0..127 as you turn it. scale maps that onto a cutoff of 200..4000 Hz for lores~, which filters a buzzy saw~. Press ▶, then drag the dial up and down: the sound gets brighter and darker.
"""
import maxpylang as mp
from maxpylang.objects import dial, ezdac_tilde, lores_tilde, saw_tilde, scale

patch = mp.MaxPatch()
knob = patch.place(dial)[0]
cutoff = patch.place(scale(0, 127, 200, 4000))[0]
saw = patch.place(saw_tilde(110))[0]
filt = patch.place(lores_tilde(600, 0.7))[0]   # 600 Hz until you turn the dial
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (knob.outs[0], cutoff.ins[0]),
    (cutoff.outs[0], filt.ins[1]),       # middle inlet: the cutoff
    (saw.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("dial")
