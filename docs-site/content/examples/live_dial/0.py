"""A Live dial on a filter
live.dial is the knob Max for Live devices use; Live can automate it. It sends 0..127 as you turn it, and scale maps that onto a 200..4000 Hz cutoff for lores~ on a buzzy saw~. Press ▶, then drag the dial up and down.
"""
import maxpylang as mp
from maxpylang.objects import ezdac_tilde, live_dial, lores_tilde, saw_tilde, scale

patch = mp.MaxPatch()
knob = patch.place(live_dial)[0]
cutoff = patch.place(scale(0, 127, 200, 4000))[0]
buzz = patch.place(saw_tilde(110))[0]
filt = patch.place(lores_tilde(800, 0.6))[0]   # 800 Hz until you turn the dial
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (knob.outs[0], cutoff.ins[0]),
    (cutoff.outs[0], filt.ins[1]),
    (buzz.outs[0], filt.ins[0]),
    (filt.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("live_dial")
